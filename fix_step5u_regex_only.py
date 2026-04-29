# path: fix_step5u_regex_only.py
from pathlib import Path
import shutil
import os
import re

ROOT = Path(os.environ.get("TEMPASI_ROOT", "/home/aleksim/tempasi"))
BACKUP = ROOT / ".step5u_hotfix_backups"
BACKUP.mkdir(parents=True, exist_ok=True)

rel = "tests/financeCreditLedger.ui.test.cjs"
path = ROOT / rel
backup = BACKUP / rel
backup.parent.mkdir(parents=True, exist_ok=True)

if not path.exists():
    raise SystemExit(f"Missing file: {path}")

if not backup.exists():
    shutil.copy2(path, backup)

text = path.read_text(encoding="utf-8")

# The first Step 5U patch inserted a regex literal with over-escaped slashes.
# In JS regex syntax that becomes invalid flags after the regex body.
bad_block = '''    assert.match(
      routes,
      /router\\.get\\(['\\"]\\\\/finance\\\\/credit-ledger\\\\/export\\\\.csv['\\"],\\s*requireAuthPage,\\s*CreditLedgerController\\.handleCreditLedgerCsv\\)/,
      "cabinet routes should expose a protected CSV export endpoint for the credit ledger"
    );'''

good_block = '''    assert.ok(
      routes.includes("router.get('/finance/credit-ledger/export.csv', requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);")
        || routes.includes('router.get("/finance/credit-ledger/export.csv", requireAuthPage, CreditLedgerController.handleCreditLedgerCsv);'),
      "cabinet routes should expose a protected CSV export endpoint for the credit ledger"
    );'''

if bad_block in text:
    text = text.replace(bad_block, good_block)
elif "cabinet routes should expose a protected CSV export endpoint for the credit ledger" in text and "routes.includes(\"router.get('/finance/credit-ledger/export.csv'" not in text:
    # Fallback: replace the entire assert.match(routes, /router.../, message) block.
    pattern = re.compile(
        r'''    assert\.match\(\n      routes,\n      /router.*?CreditLedgerController\\\.handleCreditLedgerCsv\\\)/,\n      "cabinet routes should expose a protected CSV export endpoint for the credit ledger"\n    \);''',
        re.DOTALL,
    )
    text, count = pattern.subn(good_block, text, count=1)
    if count != 1:
        raise SystemExit("Could not locate the invalid protected export route assertion")
else:
    print("SKIP: protected export route assertion already appears fixed")

path.write_text(text, encoding="utf-8")
print(f"PATCHED: {rel}")
print("")
print("Next syntax check:")
print("  node -c tests/financeCreditLedger.ui.test.cjs")
