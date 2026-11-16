import { phonePairingLink } from "@openmausbot/phone-protocol/pairing-link.ts";
import type { PairResponse } from "@openmausbot/phone-protocol/responses.ts";
import { problemText } from "@/api/errors";
import { computerUrl, pair, readManualPairing, readPairingLink, readServerPairingLink } from "@/api/pairing";
import { fakeFetch, jsonResponse } from "@/testing/fake-desktop";

const TOKEN = `omb_pair_${"A".repeat(43)}`;

const PAIRED: PairResponse = {
  token: "device-token",
  device: { id: "d1", name: "Test iPhone", createdAt: 1, lastSeenAt: 1 },
  serverName: "Ada's Mac",
  endpoints: [{ url: "http://mac.tail1.ts.net:8810", kind: "tailnet", priority: 1 }],
};

describe("readPairingLink", () => {
  test("reads every route the computer's own link builder writes, address first", () => {
    const link = phonePairingLink({
      address: "192.168.1.20",
      port: 8810,
      token: TOKEN,
      code: "482913",
      name: "Ada's Mac",
      hosts: ["mac.local", "10.0.0.4"],
      endpoints: [
        { url: "https://ada.example.com", kind: "hosted", priority: 0 },
        { url: "http://mac.tail1.ts.net:8810", kind: "tailnet", priority: 5 },
      ],
    });
    expect(link).not.toBeNull();
    expect(readPairingLink(link!)).toEqual({
      urls: ["http://192.168.1.20:8810", "https://ada.example.com", "http://mac.tail1.ts.net:8810", "http://mac.local:8810", "http://10.0.0.4:8810"],
      credential: TOKEN,
      code: "482913",
      name: "Ada's Mac",
    });
  });

  test("refuses links without a well-formed credential or address", () => {
    expect(readPairingLink("openmausbot://pair?address=mac.local%3A8810&token=omb_pair_short")).toBeNull();
    expect(readPairingLink(`openmausbot://pair?token=${TOKEN}`)).toBeNull();
    expect(readPairingLink("https://example.com/pair?token=x")).toBeNull();
  });
});

describe("readManualPairing", () => {
  test("a bare host gets the companion's port; a six-digit code is the credential", () => {
    expect(readManualPairing("mac-studio.local", "482 913")).toEqual({
      kind: "ready",
      invite: { urls: ["http://mac-studio.local:8810"], credential: "482913" },
    });
    expect(computerUrl("http://[fd7a::1]:9000/")).toBe("http://[fd7a::1]:9000");
  });

  test("a computer's 12-character code is sent as the credential, tidied", () => {
    expect(readManualPairing("127.0.0.1:18799", "7kq2 m9xd h4tp")).toEqual({
      kind: "ready",
      invite: { urls: ["http://127.0.0.1:18799"], credential: "7KQ2-M9XD-H4TP" },
    });
  });

  test("a sign-in code from an email is explained instead of sent", () => {
    expect(readManualPairing("mac.local", "1234 5678")).toMatchObject({ kind: "problem", field: "code", text: expect.stringMatching(/sign-in code from an email/) });
  });

  test("a pasted pairing link fills in both fields", () => {
    const link = phonePairingLink({ address: "mac.local", port: 8810, token: TOKEN, code: "111222" })!;
    expect(readManualPairing(link, "")).toMatchObject({ kind: "ready", invite: { credential: TOKEN, code: "111222" } });
  });

  test("a server's pairing link fills in the address and the code", () => {
    const link = "https://mac.tail1234.ts.net:16443/pair#code=7KQ2-M9XD-H4TP";
    expect(readServerPairingLink(link)).toEqual({ address: "https://mac.tail1234.ts.net:16443", code: "7KQ2-M9XD-H4TP" });
    expect(readServerPairingLink("https://maus.example.com/pair?code=7kq2m9xdh4tp")).toEqual({ address: "https://maus.example.com", code: "7KQ2-M9XD-H4TP" });
    expect(readManualPairing(link, "")).toEqual({
      kind: "ready",
      invite: { urls: ["https://mac.tail1234.ts.net:16443"], credential: "7KQ2-M9XD-H4TP" },
    });
    expect(readServerPairingLink("https://mac.local/pair")).toBeNull();
    expect(readServerPairingLink("mac.local:8810")).toBeNull();
  });

  test("waits for both fields", () => {
    expect(readManualPairing("mac.local", "")).toEqual({ kind: "incomplete" });
  });
});

describe("pair", () => {
  test("tries the next address when one is unreachable, then keeps every route for later", async () => {
    const { fetch, calls } = fakeFetch({ "POST http://mac.local:8810/api/pair": jsonResponse(201, PAIRED) });
    const paired = await pair(
      { urls: ["http://192.168.9.9:8810", "http://mac.local:8810"], credential: "482913" },
      { deviceName: "Test iPhone", requestId: "request-id-0123456789", replacesToken: "old-token", fetch },
    );
    expect(calls.map((call) => call.url)).toEqual(["http://192.168.9.9:8810/api/pair", "http://mac.local:8810/api/pair"]);
    expect(calls[1].body).toEqual({ credential: "482913", deviceName: "Test iPhone", pairRequestId: "request-id-0123456789", replacesToken: "old-token" });
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(paired.baseUrl).toBe("http://mac.local:8810");
    expect(paired.urls).toEqual(["http://mac.local:8810", "http://mac.tail1.ts.net:8810", "http://192.168.9.9:8810"]);
    expect(paired.response.token).toBe("device-token");
  });

  test("a refusal is final and worded from its code", async () => {
    const { fetch, calls } = fakeFetch({
      "POST http://a.local:8810/api/pair": jsonResponse(401, { error: "wrong code", code: "pairing_code_wrong" }),
      "POST http://b.local:8810/api/pair": jsonResponse(201, PAIRED),
    });
    const failure = await pair({ urls: ["http://a.local:8810", "http://b.local:8810"], credential: "000000" }, { deviceName: "x", requestId: "request-id-0123456789", fetch }).catch(
      (error: unknown) => error,
    );
    expect(calls).toHaveLength(1);
    expect(failure).toMatchObject({ kind: "pairing", pairing: "pairing_code_wrong" });
    expect(problemText(failure)).toBe("That code didn't match. Check the code on the computer and try again.");
  });

  test("no address answering is offline", async () => {
    const { fetch } = fakeFetch({});
    await expect(pair({ urls: ["http://a.local:8810"], credential: "123456" }, { deviceName: "x", requestId: "request-id-0123456789", fetch })).rejects.toMatchObject({ kind: "offline" });
  });

  test("a success without a token is a bad reply", async () => {
    const { fetch } = fakeFetch({ "POST /api/pair": jsonResponse(201, { serverName: "x" }) });
    await expect(pair({ urls: ["http://a.local:8810"], credential: "123456" }, { deviceName: "x", requestId: "request-id-0123456789", fetch })).rejects.toMatchObject({ kind: "bad-reply" });
  });
});
