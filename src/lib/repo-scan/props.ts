import { keyName, nameOf, sliceOf, typeArgs, type AnyNode } from "./ast";
import type { CvaInfo, FileModel, Resolver } from "./model";
import type { RepoProp, RepoVariant } from "./types";

const NATIVE = /^(ComponentProps|ComponentPropsWithoutRef|ComponentPropsWithRef|SVGProps)$|(Attributes|HTMLProps|DOMAttributes)$/;
const MAX_TYPE = 140;

type OptionSource = "cva" | "union" | "lookup";

interface Collected {
  props: Map<string, RepoProp>;
  sources: Map<string, OptionSource>;
  native: string[];
  cvaRefs: CvaInfo[];
  notes: string[];
}

interface Ctx {
  resolver: Resolver;
  depth: number;
  seen: Set<string>;
}

const empty = (): Collected => ({ props: new Map(), sources: new Map(), native: [], cvaRefs: [], notes: [] });

const truncate = (text: string) => (text.length > MAX_TYPE ? text.slice(0, MAX_TYPE - 1) + "…" : text);

function docOf(member: AnyNode): string | null {
  const comments = (member.leadingComments as { type: string; value: string }[] | undefined) ?? [];
  const last = comments[comments.length - 1];
  if (!last || last.type !== "CommentBlock" || !last.value.startsWith("*")) return null;
  const text = last.value.slice(1).split("\n").map((l) => l.replace(/^\s*\*+\s?/, "").trim()).filter(Boolean).join(" ");
  return text || null;
}

function stringLiterals(node: AnyNode | null | undefined): string[] {
  if (!node) return [];
  if (node.type === "TSLiteralType" && (node.literal as AnyNode).type === "StringLiteral") return [(node.literal as AnyNode).value as string];
  if (node.type === "TSUnionType") return (node.types as AnyNode[]).flatMap(stringLiterals);
  return [];
}

function optionsOf(typeNode: AnyNode | undefined, model: FileModel, depth = 0): { options: string[]; source: OptionSource } | null {
  if (!typeNode || depth > 3) return null;
  if (typeNode.type === "TSUnionType") {
    const options = [...new Set(stringLiterals(typeNode))];
    return options.length >= 2 ? { options, source: "union" } : null;
  }
  if (typeNode.type === "TSTypeOperator" && typeNode.operator === "keyof") {
    const query = typeNode.typeAnnotation as AnyNode;
    const name = query.type === "TSTypeQuery" ? nameOf(query.exprName) : null;
    const keys = name ? model.lookups.get(name) : undefined;
    return keys && keys.length >= 2 ? { options: keys, source: "lookup" } : null;
  }
  if (typeNode.type === "TSTypeReference") {
    const alias = model.types.get(nameOf(typeNode.typeName) ?? "");
    if (alias?.type === "TSTypeAliasDeclaration") return optionsOf(alias.typeAnnotation as AnyNode, model, depth + 1);
  }
  return null;
}

function addMember(member: AnyNode, model: FileModel, out: Collected): void {
  if (member.type !== "TSPropertySignature" && member.type !== "TSMethodSignature") return;
  const name = keyName(member);
  if (!name) return;
  const typeNode = (member.typeAnnotation as { typeAnnotation?: AnyNode } | undefined)?.typeAnnotation;
  const found = optionsOf(typeNode, model);
  out.props.set(name, {
    name,
    type: member.type === "TSMethodSignature" ? "function" : typeNode ? truncate(sliceOf(model.code, typeNode)) : "unknown",
    required: !member.optional,
    default: null,
    description: docOf(member),
    options: found?.options ?? null,
  });
  if (found) out.sources.set(name, found.source);
  else out.sources.delete(name);
}

async function visitType(node: AnyNode | null | undefined, model: FileModel, out: Collected, ctx: Ctx): Promise<void> {
  if (!node || ctx.depth > 8) return;
  const next = { ...ctx, depth: ctx.depth + 1 };
  switch (node.type) {
    case "TSTypeLiteral":
      for (const member of node.members as AnyNode[]) addMember(member, model, out);
      return;
    case "TSIntersectionType":
      for (const part of node.types as AnyNode[]) await visitType(part, model, out, next);
      return;
    case "TSParenthesizedType":
      return visitType(node.typeAnnotation as AnyNode, model, out, next);
    case "TSTypeReference":
      return visitRef(nameOf(node.typeName), typeArgs(node), sliceOf(model.code, node), model, out, next);
    case "TSUnionType":
      out.notes.push("Props are a union type, so only the type text is shown");
      return;
  }
}

async function visitRef(name: string | null, args: AnyNode[], text: string, model: FileModel, out: Collected, ctx: Ctx): Promise<void> {
  if (!name) return;

  if (name === "VariantProps") {
    const query = args[0];
    const ref = query?.type === "TSTypeQuery" ? nameOf(query.exprName) : null;
    const found = ref ? await ctx.resolver.lookup(model, ref, (m, l) => m.cvas.get(l)) : null;
    if (found) out.cvaRefs.push(found.value);
    else out.notes.push(`Couldn't find the variants for \`${ref ?? "VariantProps"}\``);
    return;
  }

  if (name === "Omit" || name === "Pick" || name === "Partial" || name === "Required" || name === "Readonly") {
    const inner = empty();
    await visitType(args[0], model, inner, ctx);
    const keys = stringLiterals(args[1]);
    for (const [key, prop] of inner.props) {
      if (name === "Omit" && keys.includes(key)) continue;
      if (name === "Pick" && !keys.includes(key)) continue;
      out.props.set(key, name === "Partial" ? { ...prop, required: false } : name === "Required" ? { ...prop, required: true } : prop);
      const source = inner.sources.get(key);
      if (source) out.sources.set(key, source);
    }
    if (name !== "Pick") out.native.push(...inner.native);
    out.cvaRefs.push(...inner.cvaRefs);
    out.notes.push(...inner.notes);
    return;
  }

  if (name === "PropsWithChildren" || name === "PropsWithRef" || name === "PropsWithoutRef") {
    await visitType(args[0], model, out, ctx);
    if (name === "PropsWithChildren" && !out.props.has("children")) {
      out.props.set("children", { name: "children", type: "ReactNode", required: false, default: null, description: null, options: null });
    }
    return;
  }

  if (NATIVE.test(name)) {
    out.native.push(text);
    return;
  }

  const found = await ctx.resolver.lookup(model, name, (m, l) => m.types.get(l));
  if (!found) {
    out.notes.push(`Couldn't read props from \`${name}\``);
    return;
  }
  const key = `${found.model.path}::${name}`;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const decl = found.value;
  if (decl.type === "TSInterfaceDeclaration") {
    for (const ext of (decl.extends as AnyNode[] | undefined) ?? []) {
      await visitRef(nameOf(ext.expression), typeArgs(ext), sliceOf(found.model.code, ext), found.model, out, ctx);
    }
    for (const member of (decl.body as unknown as { body: AnyNode[] }).body) addMember(member, found.model, out);
  } else if (decl.type === "TSTypeAliasDeclaration") {
    await visitType(decl.typeAnnotation as AnyNode, found.model, out, ctx);
  }
}

export interface CollectedProps {
  props: RepoProp[];
  nativeProps: string | null;
  variants: RepoVariant[];
  notes: string[];
}

export async function collectProps(
  typeNode: AnyNode | null,
  model: FileModel,
  resolver: Resolver,
  defaults: Map<string, string>
): Promise<CollectedProps> {
  const out = empty();
  await visitType(typeNode, model, out, { resolver, depth: 0, seen: new Set() });

  for (const cva of out.cvaRefs) {
    for (const group of cva.groups) {
      const existing = out.props.get(group.name);
      out.props.set(group.name, {
        name: group.name,
        type: group.options.map((o) => JSON.stringify(o)).join(" | "),
        required: false,
        default: group.default,
        description: existing?.description ?? null,
        options: group.options,
      });
      out.sources.set(group.name, "cva");
    }
  }

  const props = [...out.props.values()].map((p) => ({ ...p, default: defaults.get(p.name) ?? p.default }));
  const variants: RepoVariant[] = props
    .filter((p) => p.options)
    .map((p) => ({ name: p.name, options: p.options!, default: p.default, source: out.sources.get(p.name) ?? "union" }));
  const native = [...new Set(out.native)];
  return { props, nativeProps: native.length ? native.join(" & ") : null, variants, notes: [...new Set(out.notes)] };
}
