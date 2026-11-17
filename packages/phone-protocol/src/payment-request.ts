/**
 * A bot's ask to pay, waiting on the person: with a saved card (Pay), or,
 * with `needsCard`, with a card the person types into the card itself, which
 * answers it. Security: display data only (the card's label and last four
 * digits, never its number). An approval lets that bot fill that card once, in
 * that conversation, on a page of that site, within PAYMENT_APPROVAL_MS, while
 * the page still shows that total.
 */
export interface PaymentRequest {
  requestId: string;
  botId: string;
  threadId: string;
  /** Empty until the person adds a card to a `needsCard` ask. */
  cardId: string;
  /** Such as Personal Visa (Visa ••4242); empty until a card is added. */
  cardLabel: string;
  /** The person adds the card on the ask itself; it is only approved that way, never with Pay. */
  needsCard?: true;
  /** The added card was saved to the Vault. */
  saved?: true;
  /** The checkout's site, such as example.com. */
  site: string;
  /** The total as the bot read it off the page, such as $42.10. */
  amount: string;
  /** What is being bought, in the bot's words. */
  item: string;
  result?: { state: "approved" | "declined" | "expired"; text: string; at: number };
  /** The approved fill was used. */
  usedAt?: number;
  /** The bot's parked turn took the result. */
  resumed?: boolean;
}

export const PAYMENT_APPROVAL_MS = 15 * 60 * 1000;
