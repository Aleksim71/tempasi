from pathlib import Path
import re

# ------------------------------------------------------------
# 1) Add shared DB lifecycle helper for tests.
# ------------------------------------------------------------
helper = Path("tests/helpers/closeDbAfterTest.cjs")
helper.write_text(r'''// path: tests/helpers/closeDbAfterTest.cjs
/* eslint-env node */
'use strict';

function pushCloser(closers, owner, methodName) {
  if (!owner || typeof owner[methodName] !== 'function') return;

  closers.push(async () => {
    await owner[methodName]();
  });
}

function collectClosers(root, seenObjects = new Set(), closers = []) {
  if (!root || typeof root !== 'object') return closers;
  if (seenObjects.has(root)) return closers;

  seenObjects.add(root);

  pushCloser(closers, root, 'close');
  pushCloser(closers, root, 'end');

  for (const key of ['pool', 'db', 'client', 'default', 'database']) {
    if (root[key] && typeof root[key] === 'object') {
      collectClosers(root[key], seenObjects, closers);
    }
  }

  return closers;
}

function tryRequireDefaultDb() {
  try {
    return require('../../src/config/db.cjs');
  } catch (_) {
    return null;
  }
}

async function closeDbAfterTest(...roots) {
  const effectiveRoots = roots.length ? roots : [tryRequireDefaultDb()];
  const closers = [];

  for (const root of effectiveRoots) {
    collectClosers(root, new Set(), closers);
  }

  const errors = [];

  for (const close of closers) {
    try {
      await close();
      return;
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length && process.env.TEMPASI_STRICT_DB_CLOSE === '1') {
    throw errors[errors.length - 1];
  }
}

module.exports = {
  closeDbAfterTest,
  closeDbLike: closeDbAfterTest,
};
''', encoding="utf-8")
print("WRITTEN:", helper)

# ------------------------------------------------------------
# 2) Replace local DB closer in Finance UI test.
# ------------------------------------------------------------
p = Path("tests/financeCreditLedger.ui.test.cjs")
t = p.read_text(encoding="utf-8")

if "closeDbAfterTest.cjs" not in t:
    # Remove old local helper function.
    t = re.sub(
        r'\nasync function closeDbAfterTest\(\) \{.*?\n\}\n\n(?=afterAll\(async \(\) => \{)',
        '\n',
        t,
        flags=re.S,
    )

    # Add shared helper import after strict mode or after first import block.
    if '"use strict";' in t:
        t = t.replace(
            '"use strict";',
            '"use strict";\n\nconst { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");',
            1,
        )
    elif "'use strict';" in t:
        t = t.replace(
            "'use strict';",
            "'use strict';\n\nconst { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');",
            1,
        )
    else:
        t = 'const { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");\n' + t

p.write_text(t, encoding="utf-8")
print("PATCHED:", p)

# ------------------------------------------------------------
# 3) Replace local DB closer in paymentWebhook controller test.
# ------------------------------------------------------------
p = Path("tests/paymentWebhook.controller.test.cjs")
t = p.read_text(encoding="utf-8")

if "closeDbAfterTest.cjs" not in t:
    if "'use strict';" in t:
        t = t.replace(
            "'use strict';",
            "'use strict';\n\nconst { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');",
            1,
        )
    elif '"use strict";' in t:
        t = t.replace(
            '"use strict";',
            '"use strict";\n\nconst { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");',
            1,
        )
    else:
        t = "const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');\n" + t

    # Remove old local closeDb function.
    t = re.sub(
        r'\nasync function closeDb\(\) \{.*?\n\}\n\n(?=describe\()',
        '\n',
        t,
        flags=re.S,
    )

    # Replace afterAll call.
    t = t.replace("await closeDb();", "await closeDbAfterTest(db);")

p.write_text(t, encoding="utf-8")
print("PATCHED:", p)

# ------------------------------------------------------------
# 4) Replace local DB closer in creditLedger integration test.
# ------------------------------------------------------------
p = Path("tests/creditLedger.integration.test.cjs")
t = p.read_text(encoding="utf-8")

if "closeDbAfterTest.cjs" not in t:
    if "'use strict';" in t:
        t = t.replace(
            "'use strict';",
            "'use strict';\n\nconst { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');",
            1,
        )
    else:
        # File currently starts with const crypto; add helper above it.
        t = "const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');\n" + t

    # Remove old local closeDb function.
    t = re.sub(
        r'\nasync function closeDb\(\) \{.*?\n\}\n\n(?=describe\("creditLedger real DB integration")',
        '\n',
        t,
        flags=re.S,
    )

    # Replace afterAll call.
    t = t.replace("await closeDb();", "await closeDbAfterTest(dbModule, db);")

p.write_text(t, encoding="utf-8")
print("PATCHED:", p)

# ------------------------------------------------------------
# 5) Replace local afterAll in cases service test if it matches the simple shape.
# ------------------------------------------------------------
p = Path("tests/cases.service.test.cjs")
t = p.read_text(encoding="utf-8")

if "closeDbAfterTest.cjs" not in t:
    if "'use strict';" in t:
        t = t.replace(
            "'use strict';",
            "'use strict';\n\nconst { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');",
            1,
        )
    elif '"use strict";' in t:
        t = t.replace(
            '"use strict";',
            '"use strict";\n\nconst { closeDbAfterTest } = require("./helpers/closeDbAfterTest.cjs");',
            1,
        )
    else:
        t = "const { closeDbAfterTest } = require('./helpers/closeDbAfterTest.cjs');\n" + t

    t = re.sub(
        r'afterAll\(async \(\) => \{\s*if \(db && typeof db\.end === [\'"]function[\'"]\) \{\s*await db\.end\(\);\s*\}\s*\}\);',
        'afterAll(async () => {\n    await closeDbAfterTest(db);\n  });',
        t,
        flags=re.S,
    )

p.write_text(t, encoding="utf-8")
print("PATCHED:", p)
