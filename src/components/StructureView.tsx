import { useEffect, useRef } from 'react';
// @ts-ignore - smiles-drawer ships its own types; defensive import for bundlers
import SmilesDrawer from 'smiles-drawer';

/**
 * StructureView — renders textbook chemistry structures inline.
 *
 * Our pipeline emits `SMILES: <token>` markers (RDKit-validated at ingest).
 * This component draws each marker as an SVG molecule via SmilesDrawer and
 * leaves all other text untouched. Invalid SMILES fall back to plain text —
 * rendering never crashes the page (critical on production).
 */

const SMILES_RE = /SMILES:\s*([^\s,;\"']{2,120})/g;

export function extractSmilesMarkers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SMILES_RE.lastIndex = 0;
  while ((m = SMILES_RE.exec(text)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function looksDrawable(smi: string): boolean {
  // SmilesDrawer.parse would reject these anyway (caught), but pre-filter
  // obvious non-SMILES so prose like "SMILES: see figure" never flashes.
  return smi.length >= 2 && /[A-Za-z]/.test(smi) && !/\s/.test(smi);
}

function StructureSvg({ smiles, small }: { smiles: string; small?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const w = small ? 120 : 220;
  const h = small ? 90 : 160;

  useEffect(() => {
    let cancelled = false;
    try {
      const drawer = new SmilesDrawer.SvgDrawer({ width: w, height: h });
      SmilesDrawer.parse(
        smiles,
        (tree: unknown) => {
          if (!cancelled && ref.current) {
            try {
              drawer.draw(tree, ref.current, 'light');
            } catch {
              /* fall back to text below */
            }
          }
        },
        () => {
          /* parse error -> text fallback */
        }
      );
    } catch {
      /* unsupported environment -> text fallback */
    }
    return () => {
      cancelled = true;
    };
  }, [smiles, w, h]);

  return (
    <span className="inline-flex flex-col items-center gap-1 align-middle mx-1 my-1">
      <svg ref={ref} width={w} height={h} className="rounded-xl border bg-white" role="img" aria-label={`Chemical structure ${smiles}`} />
      <span className="text-[10px] font-mono text-zinc-500 max-w-[220px] truncate">{smiles}</span>
    </span>
  );
}

export default function StructureView({
  text,
  small,
  className,
}: {
  text: string | null | undefined;
  small?: boolean;
  className?: string;
}) {
  if (!text) return null;
  const parts: Array<{ kind: 'text'; t: string } | { kind: 'smiles'; smi: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SMILES_RE.lastIndex = 0;
  while ((m = SMILES_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', t: text.slice(last, m.index) });
    parts.push({ kind: 'smiles', smi: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', t: text.slice(last) });
  if (parts.every((p) => p.kind === 'text')) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === 'text' ? (
          <span key={i}>{p.t}</span>
        ) : looksDrawable(p.smi) ? (
          <StructureSvg key={i} smiles={p.smi} small={small} />
        ) : (
          <span key={i} className="font-mono text-xs">
            SMILES: {p.smi}
          </span>
        )
      )}
    </span>
  );
}
