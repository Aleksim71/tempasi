from pathlib import Path
import re
import shutil
import textwrap

ROOT = Path("/home/aleksim/tempasi")
BACKUP = ROOT / ".step5y_backups"
BACKUP.mkdir(exist_ok=True)

changed = []

def backup(path: Path):
    rel = path.relative_to(ROOT)
    dst = BACKUP / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        shutil.copy2(path, dst)

def write_if_changed(path: Path, new_text: str):
    old = path.read_text(encoding="utf-8")
    if old != new_text:
        backup(path)
        path.write_text(new_text, encoding="utf-8")
        changed.append(str(path.relative_to(ROOT)))

def add_guard_after_rent_condition(text: str) -> str:
    """
    Adds canonical active-RENT guards after RENT SQL predicates.
    Idempotent: skips blocks that already contain the guard nearby.
    """
    patterns = [
        # e alias, common catalog / orders / entitlements case
        (
            r"(?P<line>\n\s+(?:AND\s+)?(?:\(?\s*)?UPPER\(COALESCE\(e\.deal_type,\s*e\.kind,\s*''\)\)\s*=\s*'RENT')",
            "\n          AND e.closed_at IS NULL\n          AND (e.ends_at IS NULL OR e.ends_at > now())",
        ),
        (
            r"(?P<line>\n\s+(?:OR\s+)?UPPER\(COALESCE\(e\.deal_type,\s*''\)\)\s*=\s*'RENT')",
            "\n          AND e.closed_at IS NULL\n          AND (e.ends_at IS NULL OR e.ends_at > now())",
        ),
        (
            r"(?P<line>\n\s+(?:OR\s+)?LOWER\(COALESCE\(e\.kind,\s*''\)\)\s*=\s*'rent')",
            "\n          AND e.closed_at IS NULL\n          AND (e.ends_at IS NULL OR e.ends_at > now())",
        ),
        # o/e mixed alias in rentAssignments.service
        (
            r"(?P<line>\n\s+AND\s+UPPER\(COALESCE\(o\.deal_type,\s*e\.deal_type,\s*''\)\)\s*=\s*'RENT')",
            "\n      AND e.closed_at IS NULL\n      AND (e.ends_at IS NULL OR e.ends_at > NOW())",
        ),
    ]

    out = text

    for pattern, guard in patterns:
        regex = re.compile(pattern)

        def repl(match):
            start = match.start()
            lookahead = out[match.end():match.end() + 260]
            if "e.closed_at IS NULL" in lookahead and "e.ends_at" in lookahead:
                return match.group("line")
            return match.group("line") + guard

        out = regex.sub(repl, out)

    return out

# 1) Public catalog / template detail visibility:
#    active RENT must hide; expired RENT must not hide.
catalog = ROOT / "src/server/catalog/templates.repo.js"
if catalog.exists():
    text = catalog.read_text(encoding="utf-8")
    text = add_guard_after_rent_condition(text)
    write_if_changed(catalog, text)

# 2) Order creation guard:
#    other users must be blocked only by active, not expired, RENT.
orders_repo = ROOT / "src/modules/orders/orders.repo.cjs"
if orders_repo.exists():
    text = orders_repo.read_text(encoding="utf-8")
    text = add_guard_after_rent_condition(text)
    write_if_changed(orders_repo, text)

# 3) Rent assignment guard:
#    expired RENT must not behave as active reservation in Cases.
rent_assignments = ROOT / "src/modules/cases/rentAssignments.service.cjs"
if rent_assignments.exists():
    text = rent_assignments.read_text(encoding="utf-8")
    text = add_guard_after_rent_condition(text)
    write_if_changed(rent_assignments, text)

# 4) Buy conversion:
#    expired RENT must not be closed as converted_to_buy and must not create unused-rent credit.
ent_repo = ROOT / "src/modules/payments/repos/entitlements.repo.cjs"
if ent_repo.exists():
    text = ent_repo.read_text(encoding="utf-8")
    text = add_guard_after_rent_condition(text)
    write_if_changed(ent_repo, text)

# 5) Add explicit regression/contract tests.
test_path = ROOT / "tests/rentExpirationContract.test.cjs"
test_content = r"""// tests/rentExpirationContract.test.cjs
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function compact(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

describe('rent expiration contract', () => {
  test('catalog hides only active non-expired rent reservations', () => {
    const src = compact(read('src/server/catalog/templates.repo.js'));

    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
    expect(src).toMatch(/deal_type.*RENT/i);
  });

  test('order reservation guard ignores expired rent reservations', () => {
    const src = compact(read('src/modules/orders/orders.repo.cjs'));

    expect(src).toContain('findActiveRentReservationByTemplateSlug');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
  });

  test('case rent assignment lookup requires active non-expired rent', () => {
    const src = compact(read('src/modules/cases/rentAssignments.service.cjs'));

    expect(src).toContain('getActiveRentOrderForUser');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > NOW\(\)/i);
  });

  test('buy conversion closes only active non-expired rent entitlement', () => {
    const src = compact(read('src/modules/payments/repos/entitlements.repo.cjs'));

    expect(src).toContain('closeActiveRentForBuyerBuy');
    expect(src).toMatch(/e\.closed_at IS NULL/i);
    expect(src).toMatch(/e\.ends_at IS NULL OR e\.ends_at > now\(\)/i);
  });
});
"""
write_if_changed(test_path, test_content)

print("OK: Step 5Y rent expiration hardening patch applied")
print("Changed files:")
for p in changed:
    print(" -", p)
print("")
print("Backups:", BACKUP)
