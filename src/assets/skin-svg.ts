/** Portable, inert SVG fragments: no scripts, CSS, external resources or entities. */
const TAGS = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'clipPath']);
const ATTRS = new Set([
  'id', 'class', 'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
  'cx', 'cy', 'r', 'rx', 'ry', 'transform', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
  'stroke-dashoffset', 'fill-rule', 'clip-rule', 'opacity', 'fill-opacity',
  'stroke-opacity', 'clip-path', 'clipPathUnits', 'vector-effect', 'color',
]);

/** Validate syntax and scope fragment-local IDs to this artwork slot. */
export function skinSvg(value: unknown, path: string, prefix: string): string {
  if (typeof value !== 'string' || value.length > 250_000) throw new Error(`${path}: expected an SVG fragment under 250,000 characters`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${path}: invalid XML control character`);
  const stack: string[] = [], ids = new Set<string>(), refs: string[] = [];
  let at = 0;
  const result = value.replace(/<[^>]*>/g, (tag, offset: number) => {
    if (value.slice(at, offset).trim()) throw new Error(`${path}: only SVG elements and whitespace are allowed`);
    at = offset + tag.length;
    const close = /^<\/([A-Za-z]+)\s*>$/.exec(tag);
    if (close) {
      if (stack.pop() !== close[1]) throw new Error(`${path}: mismatched closing tag`);
      return tag;
    }
    const match = /^<([A-Za-z]+)([\s\S]*?)(\/?)>$/.exec(tag);
    if (!match || !TAGS.has(match[1])) throw new Error(`${path}: unsupported SVG element`);
    const [, name, attributes, selfClosing] = match;
    let consumed = 0;
    const seen = new Set<string>();
    const rewritten = attributes.replace(/\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(["'])(.*?)\2/g, (whole: string, key: string, _quote: string, val: string, offset: number) => {
      if (attributes.slice(consumed, offset).trim() || !ATTRS.has(key) || seen.has(key)) throw new Error(`${path}: unsupported or duplicate SVG attribute ${key}`);
      consumed = offset + whole.length;
      seen.add(key);
      if (/[<>&\\]/.test(val)) throw new Error(`${path}: entities and escaped values are not supported`);
      if (key === 'id') {
        if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(val) || ids.has(val)) throw new Error(`${path}: invalid or duplicate id`);
        ids.add(val);
        val = `${prefix}-${val}`;
      } else if (key === 'clip-path') {
        const ref = /^url\(#([A-Za-z][A-Za-z0-9_-]*)\)$/.exec(val);
        if (!ref) throw new Error(`${path}: clip-path must reference a local id`);
        refs.push(ref[1]);
        val = `url(#${prefix}-${ref[1]})`;
      } else if (/url\s*\(|[;{}]/i.test(val)) {
        throw new Error(`${path}: external references and CSS declarations are not supported`);
      }
      return ` ${key}="${val.replace(/"/g, '&quot;')}"`;
    });
    if (attributes.slice(consumed).trim()) throw new Error(`${path}: malformed SVG attributes`);
    if (!selfClosing) stack.push(name);
    return `<${name}${rewritten}${selfClosing}>`;
  });
  if (value.slice(at).trim() || stack.length) throw new Error(`${path}: malformed SVG fragment`);
  if (refs.some(id => !ids.has(id))) throw new Error(`${path}: missing local clip-path id`);
  return result;
}
