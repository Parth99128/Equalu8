"""
Chemical structure validation — RDKit when importable, pure-Python fallback otherwise.

PRODUCTION NOTE (4GB Azure VM): RDKit is intentionally NOT in requirements.txt.
If `pip install rdkit` fails there, every function below still works in a
degraded-but-safe mode: structures are syntax-checked only, and unvalidated
SMILES are never stored or trusted for scoring. Install RDKit (pip or conda)
on any machine where structure features must be authoritative.

RDKit path   : validity + canonical SMILES + formula + ring info + equivalence.
Fallback path: SMILES syntax sanity (balanced parens/brackets/ring digits,
valid element symbols, non-empty) — catches hallucinated garbage, but cannot
prove chemical validity. Results carry `validated: False`.
"""

import re

try:
    from rdkit import Chem
    from rdkit.Chem import rdMolDescriptors
    HAS_RDKIT = True
except Exception:
    Chem = None
    rdMolDescriptors = None
    HAS_RDKIT = False

# Organic-subset + common hetero atoms accepted by the fallback checker.
_ELEMENTS = {
    "H", "He", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P",
    "S", "Cl", "Ar", "K", "Ca", "Fe", "Cu", "Zn", "Br", "I", "Mn", "Cr",
    "Ni", "Co", "Pt", "Pd", "Sn", "Pb", "Se", "Li", "Be",
}

_SMILES_TOKEN_RE = re.compile(
    r"(\[[^\]]+\]|Br|Cl|@@|@|%[0-9]{2}|[A-Za-z0-9\-+#=\(\)\[\]/\\.%])"
)


def _fallback_syntax_ok(smiles: str) -> bool:
    """Pure-Python SMILES sanity gate. No chemistry proven, garbage rejected."""
    if not smiles or len(smiles) > 500:
        return False
    s = smiles.strip()
    if s.count("(") != s.count(")"):
        return False
    if s.count("[") != s.count("]"):
        return False
    # Ring-closure digits must each appear an even number of times.
    for d in set(re.findall(r"%?(\d)", re.sub(r"\[[^\]]+\]", "", s))):
        if s.count(d) % 2 and f"%{d}" not in s:
            # single %NN closures counted via the two-digit form
            if sum(1 for m in re.finditer(rf"%{d}\b|(?<!%){d}", s)) % 2:
                return False
    # Every bare element token must be a known symbol.
    for tok in _SMILES_TOKEN_RE.findall(s):
        if re.fullmatch(r"[A-Za-z][a-z]?", tok) and tok not in _ELEMENTS:
            # allow aromatic lowercase subset explicitly
            if tok not in ("c", "n", "o", "s", "p"):
                return False
    # Must contain at least one carbon (organic scope of this feature).
    return bool(re.search(r"[Cc]", s))


def canonicalize(smiles: str):
    """Return (canonical_smiles, info) or (None, {'reason': ...}).

    info: {validated: bool, formula, rings, atoms, source: 'rdkit'|'fallback'}.
    """
    if not smiles or not isinstance(smiles, str):
        return None, {"reason": "empty"}
    s = smiles.strip().strip("`\"' ")
    if HAS_RDKIT:
        try:
            mol = Chem.MolFromSmiles(s)
            if mol is None:
                return None, {"reason": "rdkit-rejected"}
            canon = Chem.MolToSmiles(mol, canonical=True)
            try:
                formula = rdMolDescriptors.CalcMolFormula(mol)
            except Exception:
                formula = ""
            try:
                rings = mol.GetRingInfo().NumRings()
            except Exception:
                rings = 0
            return canon, {
                "validated": True,
                "formula": formula,
                "rings": rings,
                "atoms": mol.GetNumAtoms(),
                "source": "rdkit",
            }
        except Exception as e:
            return None, {"reason": f"rdkit-error: {e}"[:120]}
    if _fallback_syntax_ok(s):
        return s, {"validated": False, "formula": "", "rings": -1, "atoms": -1, "source": "fallback"}
    return None, {"reason": "syntax-rejected"}


def equivalent(a: str, b: str) -> bool:
    """True when two SMILES denote the same molecule (or identical strings)."""
    if not a or not b:
        return False
    ca, _ = canonicalize(a)
    cb, _ = canonicalize(b)
    if ca is None or cb is None:
        return False
    if HAS_RDKIT:
        return ca == cb
    # Fallback: exact match after whitespace/case normalization only.
    norm = lambda s: re.sub(r"\s+", "", s.strip())
    return norm(a) == norm(b)


def find_smiles(text: str):
    """Extract candidate SMILES-like tokens from model/prose text."""
    if not text:
        return []
    cands = []
    # fenced or quoted: ```smiles ... ``` / SMILES: c1ccccc1
    for m in re.finditer(r"```(?:smiles)?\s*([^\s`]{2,200})\s*```", text, re.I):
        cands.append(m.group(1))
    for m in re.finditer(r"SMILES\s*[:=]\s*([^\s,;\"']{2,200})", text, re.I):
        cands.append(m.group(1))
    # bare ring-containing tokens (c1ccccc1, C1CCCCC1, etc.)
    for m in re.finditer(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9\[].*\d)([A-Za-z0-9@+\-#=\(\)\[\]/\\%.]{4,200})(?![A-Za-z0-9])", text):
        tok = m.group(1)
        if any(ch.isdigit() for ch in tok) and re.search(r"[Cc]", tok):
            cands.append(tok)
    # dedupe, preserve order
    seen, out = set(), []
    for c in cands:
        if c not in seen:
            seen.add(c)
            out.append(c)
    return out[:10]
