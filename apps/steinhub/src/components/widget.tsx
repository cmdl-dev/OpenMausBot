import {
  PHONE_PAIRING_ACTION,
  threadActionTarget,
  widgetActions,
  widgetFieldOptions,
  widgetFields,
  widgetInitialValues,
  widgetNumber,
  widgetScope,
  widgetString,
  type WidgetActionEntry,
  type WidgetButtonSpec,
  type WidgetNode,
  type WidgetPayload,
  type WidgetValues,
} from "@openmausbot/phone-protocol/widget.ts";
import { buttonStyle } from "@openmausbot/phone-protocol/widget-button-style.ts";
import { router } from "expo-router";
import { Check } from "lucide-react-native";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Pressable, StyleSheet, TextInput, View, type ViewStyle } from "react-native";
import { DesktopError, problemText } from "@/api/errors";
import { Button, type ButtonProps } from "@/components/button";
import { Chip } from "@/components/chip";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/status";
import { Txt, type TextTone, type TxtProps } from "@/components/text";
import { colors, radius, size, space, type, type Status, type TypeToken } from "@/theme";

export interface WidgetCardProps {
  payload: WidgetPayload;
  hostName: string;
  /** Sends a press on a button the computer answers (not a link or a chat to open). */
  onPress(press: { ref: string; values?: WidgetValues }): Promise<void>;
}

interface WidgetForm {
  actions: Map<string, WidgetActionEntry>;
  values: WidgetValues;
  setValue(name: string, value: string | boolean): void;
  pending: string | null;
  settled: boolean;
  press(ref: string): void;
}

const FormContext = createContext<WidgetForm | null>(null);

function useForm(): WidgetForm {
  const form = useContext(FormContext);
  if (!form) throw new Error("widget node outside its card");
  return form;
}

/** A widget as the desktop draws it: its text, rows and buttons, with the buttons live. */
export function WidgetCard({ payload, hostName, onPress }: WidgetCardProps) {
  const { root, settled } = payload;
  const actions = useMemo(() => new Map(widgetActions(root).map((entry) => [entry.ref, entry])), [root]);
  const [edits, setEdits] = useState<WidgetValues>({});
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const values = useMemo(() => ({ ...widgetInitialValues(root), ...edits, ...settled?.values }), [root, edits, settled]);

  async function press(ref: string) {
    const entry = actions.get(ref);
    if (!entry || pending) return;
    if (entry.client) {
      openOnPhone(entry);
      return;
    }
    if (settled) return;
    const scope = entry.tone === "cancel" ? [] : widgetFields(widgetScope(root, ref), root);
    const missing = entry.tone ? scope.find((field) => field.node.required === true && !values[field.name]) : undefined;
    if (missing) {
      setProblem(`${missing.label} is required.`);
      return;
    }
    const sending = scope.length ? Object.fromEntries(scope.map((field) => [field.name, values[field.name] ?? (field.type === "Checkbox" ? false : "")])) : undefined;
    setPending(ref);
    setProblem(null);
    try {
      await onPress({ ref, ...(sending ? { values: sending } : {}) });
    } catch (error) {
      setProblem(pressProblem(error, hostName));
    } finally {
      setPending(null);
    }
  }

  const form: WidgetForm = {
    actions,
    values,
    setValue: (name, value) => setEdits((current) => ({ ...current, [name]: value })),
    pending,
    settled: Boolean(settled),
    press: (ref) => void press(ref),
  };

  const title = widgetString(root, "title");
  const caption = widgetString(root, "caption");
  const meta = widgetString(root, "meta");
  const status = isRecord(root.status) && typeof root.status.text === "string" ? root.status.text : undefined;
  const footer = (["confirm", "cancel"] as const).flatMap((key) => (isRecord(root[key]) ? [{ key, spec: root[key] as unknown as WidgetButtonSpec }] : []));

  return (
    <FormContext.Provider value={form}>
      <View style={styles.card} accessibilityLabel={title}>
        {status ? (
          <Txt variant="footnote" tone="secondary">
            {status}
          </Txt>
        ) : null}
        {title || caption || meta ? (
          <View style={styles.head}>
            {title ? <Txt variant="headline">{title}</Txt> : null}
            {caption || meta ? (
              <Txt variant="footnote" tone="secondary">
                {[caption, meta].filter(Boolean).join(" · ")}
              </Txt>
            ) : null}
          </View>
        ) : null}
        <Children nodes={root.children} gap={root.type === "ListView" ? 0 : space[3]} />
        {settled ? (
          <View style={styles.settled}>
            <Check size={14} color={colors.success} strokeWidth={2.5} />
            <Txt variant="subhead" weight="600" numberOfLines={2} style={styles.shrink}>
              {settled.label}
            </Txt>
          </View>
        ) : footer.length ? (
          <View style={styles.footer}>
            {footer.map(({ key, spec }) => (
              <PressButton key={key} actionRef={key} label={spec.label} variant={key === "confirm" ? "primary" : "secondary"} />
            ))}
          </View>
        ) : null}
        {problem ? (
          <Txt variant="footnote" style={styles.problem}>
            {problem}
          </Txt>
        ) : null}
      </View>
    </FormContext.Provider>
  );
}

function openOnPhone(entry: WidgetActionEntry) {
  const thread = threadActionTarget(entry.action);
  if (thread?.botId) {
    router.navigate({ pathname: "/chat/[id]", params: { id: thread.threadId } });
    return;
  }
  const url = webLink(entry);
  if (url) void Linking.openURL(url).catch(() => undefined);
}

function webLink(entry: WidgetActionEntry): string | undefined {
  const payload = entry.action.payload;
  const url = isRecord(payload) ? payload.url : undefined;
  return entry.action.type === "open_url" && typeof url === "string" && /^https?:\/\//i.test(url) ? url : undefined;
}

/** Whether the phone can do what this button asks: a room's chat and phone pairing open only on the computer. */
function phoneCanOpen(entry: WidgetActionEntry): boolean {
  if (!entry.client) return true;
  if (entry.action.type === PHONE_PAIRING_ACTION) return false;
  return Boolean(threadActionTarget(entry.action)?.botId || webLink(entry));
}

/** The computer's own words for a press it refused ("Email is required."), else the app's sentence. */
function pressProblem(error: unknown, hostName: string): string {
  if (error instanceof DesktopError && error.kind === "refused" && (error.status === 400 || error.status === 409) && error.message) return error.message;
  return problemText(error, hostName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Children({ nodes, gap, row }: { nodes: unknown; gap: number; row?: ViewStyle }) {
  const list = Array.isArray(nodes) ? (nodes as WidgetNode[]) : [];
  if (!list.length) return null;
  return (
    <View style={[{ gap }, row]}>
      {list.map((node, index) => (
        <WidgetNodeView key={node.id ?? index} node={node} />
      ))}
    </View>
  );
}

const INK_TONES: Record<string, TextTone> = { primary: "primary", secondary: "secondary", tertiary: "tertiary" };
const INK_STATUS: Record<string, Status> = { success: "success", warning: "warning", danger: "danger" };

const WEIGHTS: Record<string, TxtProps["weight"]> = { normal: "400", medium: "500", semibold: "600", bold: "600" };
const TEXT_SIZES: Record<string, TypeToken> = { xs: "footnote", sm: "subhead", md: "body", lg: "headline", xl: "title" };
const TITLE_SIZES: Record<string, TypeToken> = { sm: "callout", md: "headline", lg: "title", xl: "title" };
const CAPTION_SIZES: Record<string, TypeToken> = { sm: "caption", md: "footnote", lg: "subhead" };
const ALIGN: Record<string, ViewStyle["alignItems"]> = { start: "flex-start", center: "center", end: "flex-end", baseline: "baseline", stretch: "stretch" };
const JUSTIFY: Record<string, ViewStyle["justifyContent"]> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly",
};
const TEXT_ALIGN = { start: "left", center: "center", end: "right" } as const;
const BADGE_TONES: Record<string, Status> = { success: "success", danger: "danger", warning: "warning", info: "info", discovery: "info" };

function WidgetText({ node, variant, weight, tone = "primary" }: { node: WidgetNode; variant: TypeToken; weight?: TxtProps["weight"]; tone?: TextTone }) {
  const ink = widgetString(node, "color") ?? "";
  const status = INK_STATUS[ink];
  const align = TEXT_ALIGN[widgetString(node, "textAlign") as keyof typeof TEXT_ALIGN];
  return (
    <Txt
      variant={variant}
      tone={INK_TONES[ink] ?? tone}
      weight={WEIGHTS[widgetString(node, "weight") ?? ""] ?? weight}
      numberOfLines={widgetNumber(node, "maxLines") ?? (node.truncate === true ? 1 : undefined)}
      style={[
        styles.shrink,
        status ? { color: colors[status] } : null,
        node.italic === true ? styles.italic : null,
        node.lineThrough === true ? styles.struck : null,
        align ? { textAlign: align } : null,
      ]}
    >
      {widgetString(node, "value") ?? ""}
    </Txt>
  );
}

/** Buttons and badges side by side flow onto the next line; anything else in a row stays on one. */
const FLOWS = new Set(["Button", "Badge"]);

function layout(node: WidgetNode, axis: "row" | "column"): ViewStyle {
  const padding = Array.isArray(node.padding) ? (node.padding as number[]) : undefined;
  const flex = widgetNumber(node, "flex");
  const children = Array.isArray(node.children) ? (node.children as WidgetNode[]) : [];
  const wraps = node.wrap === true || (children.length > 1 && children.every((child) => FLOWS.has(child.type)));
  return {
    flexDirection: axis,
    ...(axis === "row" ? { flexWrap: wraps ? "wrap" : "nowrap" } : {}),
    alignItems: ALIGN[widgetString(node, "align") ?? ""] ?? (axis === "row" ? "center" : undefined),
    justifyContent: JUSTIFY[widgetString(node, "justify") ?? ""],
    ...(padding ? { paddingTop: padding[0], paddingRight: padding[1], paddingBottom: padding[2], paddingLeft: padding[3] } : {}),
    ...(flex !== undefined ? { flexGrow: flex, flexShrink: 1, flexBasis: 0, minWidth: 0 } : {}),
  };
}

function WidgetNodeView({ node }: { node: WidgetNode }): ReactNode {
  switch (node.type) {
    case "Title":
      return <WidgetText node={node} variant={TITLE_SIZES[widgetString(node, "size") ?? "md"] ?? "title"} weight="600" />;
    case "Text":
      return <WidgetText node={node} variant={TEXT_SIZES[widgetString(node, "size") ?? "md"] ?? "body"} />;
    case "Caption":
      return <WidgetText node={node} variant={CAPTION_SIZES[widgetString(node, "size") ?? "md"] ?? "footnote"} tone="secondary" />;
    case "Label":
      return <WidgetText node={node} variant="subhead" weight="500" tone="secondary" />;
    case "Markdown":
      return <Markdown>{widgetString(node, "value") ?? ""}</Markdown>;
    case "Badge":
      return <Badge label={widgetString(node, "label") ?? ""} tone={BADGE_TONES[widgetString(node, "color") ?? ""]} />;
    case "Divider":
      return <View style={styles.divider} />;
    case "Spacer":
      return <View style={{ flexGrow: 1, minHeight: widgetNumber(node, "minSize") ?? 0, minWidth: widgetNumber(node, "minSize") ?? 0 }} />;
    case "Icon":
      return null;
    case "Image":
      return <WidgetImage node={node} />;
    case "Progress":
      return <Progress node={node} />;
    case "Chart":
      return (
        <Txt variant="footnote" tone="tertiary">
          Open this chart on the computer.
        </Txt>
      );
    case "Table":
      return <Table node={node} />;
    case "Button":
      return <WidgetButton node={node} />;
    case "ListViewItem":
      return <ListItem node={node} />;
    case "Row":
      return <Children nodes={node.children} gap={widgetNumber(node, "gap") ?? space[2]} row={layout(node, "row")} />;
    case "Box":
      return node.direction === "row" ? (
        <Children nodes={node.children} gap={widgetNumber(node, "gap") ?? space[2]} row={layout(node, "row")} />
      ) : (
        <Children nodes={node.children} gap={widgetNumber(node, "gap") ?? 0} row={layout(node, "column")} />
      );
    case "Col":
    case "Form":
    case "Transition":
      return <Children nodes={node.children} gap={widgetNumber(node, "gap") ?? (node.type === "Form" ? space[3] : 0)} row={layout(node, "column")} />;
    case "Input":
    case "Textarea":
    case "DatePicker":
    case "TimePicker":
    case "DayPicker":
      return <TypedField node={node} />;
    case "Select":
    case "RadioGroup":
      return <ChoiceField node={node} />;
    case "Checkbox":
      return <CheckField node={node} />;
    default:
      return <Children nodes={node.children} gap={space[2]} />;
  }
}

function PressButton({ actionRef, label, variant }: { actionRef: string; label: string; variant: NonNullable<ButtonProps["variant"]> }) {
  const form = useForm();
  const entry = form.actions.get(actionRef);
  const usable = entry ? phoneCanOpen(entry) && (entry.client || !form.settled) : false;
  return (
    <Button
      label={form.pending === actionRef ? `${label}…` : label}
      variant={variant}
      small
      disabled={!usable || form.pending !== null}
      onPress={() => form.press(actionRef)}
    />
  );
}

const BUTTON_VARIANTS: Record<string, NonNullable<ButtonProps["variant"]>> = { primary: "primary", secondary: "secondary", danger: "danger", quiet: "ghost" };

function WidgetButton({ node }: { node: WidgetNode }) {
  const label = widgetString(node, "label") ?? "";
  if (!label) return null;
  return <PressButton actionRef={node.id} label={label} variant={BUTTON_VARIANTS[buttonStyle(node)] ?? "secondary"} />;
}

function ListItem({ node }: { node: WidgetNode }) {
  const form = useForm();
  const entry = form.actions.get(node.id);
  const content = <Children nodes={node.children} gap={widgetNumber(node, "gap") ?? space[2]} row={layout(node, "row")} />;
  if (!entry) return <View style={styles.item}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!phoneCanOpen(entry) || form.pending !== null || (!entry.client && form.settled)}
      onPress={() => form.press(node.id)}
      style={({ pressed }) => [styles.item, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function WidgetImage({ node }: { node: WidgetNode }) {
  const src = widgetString(node, "src");
  if (!src || !/^https:\/\//i.test(src)) return null;
  return (
    <Image
      source={{ uri: src }}
      accessibilityLabel={widgetString(node, "alt")}
      resizeMode={node.fit === "contain" ? "contain" : "cover"}
      style={[styles.image, { height: widgetNumber(node, "height") ?? 160 }]}
    />
  );
}

function Progress({ node }: { node: WidgetNode }) {
  const value = Math.max(0, Math.min(1, widgetNumber(node, "value") ?? 0));
  const label = widgetString(node, "label");
  return (
    <View style={styles.progress} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      {label ? (
        <Txt variant="footnote" tone="secondary">
          {label}
        </Txt>
      ) : null}
      <View style={styles.track}>
        <View style={[styles.bar, { width: `${value * 100}%` }]} />
      </View>
    </View>
  );
}

function Table({ node }: { node: WidgetNode }) {
  const rows = Array.isArray(node.children) ? (node.children as WidgetNode[]) : [];
  return (
    <View style={styles.table}>
      {rows.map((row, index) => (
        <View key={row.id ?? index} style={[styles.tableRow, row.header === true && styles.tableHeader, index > 0 && styles.tableRule]}>
          {(Array.isArray(row.children) ? (row.children as WidgetNode[]) : []).map((cell, at) => (
            <View key={cell.id ?? at} style={[styles.cell, { flex: widgetNumber(cell, "colSpan") ?? 1 }]}>
              <Children nodes={cell.children} gap={space[1]} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function FieldLabel({ node }: { node: WidgetNode }) {
  const label = node.type === "Checkbox" ? undefined : widgetString(node, "label");
  return label ? (
    <Txt variant="subhead" weight="500" tone="secondary">
      {label}
    </Txt>
  ) : null;
}

const HINTS: Record<string, string> = { DatePicker: "YYYY-MM-DD", TimePicker: "HH:MM", DayPicker: "mon,tue,wed" };

function TypedField({ node }: { node: WidgetNode }) {
  const form = useForm();
  const name = widgetString(node, "name");
  if (!name) return null;
  const value = form.values[name];
  const multiline = node.type === "Textarea";
  const locked = form.settled || node.disabled === true;
  return (
    <View style={styles.field}>
      <FieldLabel node={node} />
      <TextInput
        accessibilityLabel={widgetString(node, "label") ?? name}
        value={typeof value === "string" ? value : ""}
        onChangeText={(text) => form.setValue(name, text)}
        editable={!locked}
        multiline={multiline}
        numberOfLines={multiline ? widgetNumber(node, "rows") ?? 3 : undefined}
        placeholder={widgetString(node, "placeholder") ?? HINTS[node.type]}
        placeholderTextColor={colors.text3}
        selectionColor={colors.text}
        keyboardType={node.inputType === "number" ? "numeric" : node.inputType === "email" ? "email-address" : "default"}
        secureTextEntry={node.inputType === "password"}
        style={[styles.input, multiline && styles.textarea, locked && styles.locked]}
      />
    </View>
  );
}

function ChoiceField({ node }: { node: WidgetNode }) {
  const form = useForm();
  const name = widgetString(node, "name");
  if (!name) return null;
  const locked = form.settled || node.disabled === true;
  return (
    <View style={styles.field}>
      <FieldLabel node={node} />
      <View style={styles.chips}>
        {widgetFieldOptions(node).map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            selected={form.values[name] === option.value}
            onPress={locked ? undefined : () => form.setValue(name, form.values[name] === option.value && node.type === "Select" ? "" : option.value)}
          />
        ))}
      </View>
    </View>
  );
}

function CheckField({ node }: { node: WidgetNode }) {
  const form = useForm();
  const name = widgetString(node, "name");
  if (!name) return null;
  const checked = form.values[name] === true;
  const locked = form.settled || node.disabled === true;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: locked }}
      disabled={locked}
      onPress={() => form.setValue(name, !checked)}
      style={styles.check}
    >
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Check size={14} color={colors.textInverse} strokeWidth={2.5} /> : null}</View>
      <Txt variant="callout" style={styles.shrink}>
        {widgetString(node, "label") ?? name}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space[4],
    gap: space[3],
  },
  head: { gap: 2 },
  footer: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  settled: { flexDirection: "row", alignItems: "center", gap: space[2] },
  problem: { color: colors.danger },
  shrink: { flexShrink: 1 },
  italic: { fontStyle: "italic" },
  struck: { textDecorationLine: "line-through" },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  item: { paddingVertical: space[2], borderRadius: radius.sm },
  pressed: { backgroundColor: colors.surface2 },
  image: { width: "100%", borderRadius: radius.md, backgroundColor: colors.surface2 },
  progress: { gap: space[1] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" },
  bar: { height: 6, backgroundColor: colors.text },
  table: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  tableRow: { flexDirection: "row" },
  tableHeader: { backgroundColor: colors.surface2 },
  tableRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cell: { paddingHorizontal: space[2], paddingVertical: 6, minWidth: 0 },
  field: { gap: space[1] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  input: {
    minHeight: size.tap,
    paddingHorizontal: space[3],
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: type.body.fontSize,
  },
  textarea: { minHeight: 88, textAlignVertical: "top" },
  locked: { opacity: 0.6 },
  check: { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: size.tap },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.text, borderColor: colors.text },
});
