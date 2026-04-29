from pathlib import Path

p = Path("tests/financeCreditLedger.page.test.cjs")
t = p.read_text(encoding="utf-8")

# ---------------------------------------------------------------------
# 1) Add helper for authenticated session reuse.
# ---------------------------------------------------------------------

anchor = """describe('Finance credit ledger page smoke (via real server)', () => {"""

helper = r"""
async function registerAndLogin(srv, email, password) {
  const register = await request(srv.baseUrl)
    .post('/api/auth/register')
    .set(srv.headers)
    .send({ email, password });

  expect([200, 201, 302, 303]).toContain(register.status);

  const login = await request(srv.baseUrl)
    .post('/api/auth/login')
    .set(srv.headers)
    .send({ email, password });

  expect(login.status).toBe(200);

  const cookie = pickSidCookie(login.headers['set-cookie']);
  expect(cookie).toBeTruthy();

  return cookie;
}

"""

if helper.strip() not in t:
  if anchor not in t:
    raise SystemExit(f"Anchor not found in {p}")
  t = t.replace(anchor, helper + anchor, 1)


# ---------------------------------------------------------------------
# 2) Add real-server tests for Finance overview link + empty ledger state.
# ---------------------------------------------------------------------

insert_after = """  it('redirects unauthenticated users to login', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const response = await request(srv.baseUrl)
        .get('/cabinet/finance/credit-ledger')
        .set(srv.headers);

      expect([302, 303]).toContain(response.status);
      expect(String(response.headers.location || '')).toMatch(/login/i);
    });
  });

"""

new_tests = r"""  it('renders Finance overview with a real Credit ledger CTA for authenticated users', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_overview_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Finance/i);
      expect(response.text).toMatch(/Tempasi credit/i);
      expect(response.text).toMatch(/Open credit ledger/i);
      expect(response.text).toMatch(/\/cabinet\/finance\/credit-ledger/i);
      expect(response.text).toMatch(/Reserved, applied, and released credit movements|checkout reservation|payment application|release/i);
    });
  });

  it('renders an empty Credit ledger page for authenticated users without credit rows', async () => {
    await migrateDb();

    await withRealServer(async (srv) => {
      const email = `finance_empty_ledger_${Date.now()}@example.com`;
      const password = 'Passw0rd__OK';
      const cookie = await registerAndLogin(srv, email, password);

      const response = await request(srv.baseUrl)
        .get('/cabinet/finance/credit-ledger')
        .set(srv.headers)
        .set('Cookie', cookie);

      expect(response.status).toBe(200);
      expect(response.text).toMatch(/Credit ledger/i);
      expect(response.text).toMatch(/No Tempasi credit movements yet/i);
      expect(response.text).toMatch(/Credits from unused converted rents will appear here/i);
      expect(response.text).toMatch(/Back to Finance overview/i);
      expect(response.text).toMatch(/\/cabinet\/finance/i);
    });
  });

"""

if new_tests.strip() not in t:
  if insert_after not in t:
    raise SystemExit(f"Insert point not found in {p}")
  t = t.replace(insert_after, insert_after + new_tests, 1)


# ---------------------------------------------------------------------
# 3) Remove duplicated inline register/login block in existing test if present.
#    Keep safe: do not rewrite whole test, only replace obvious local setup.
# ---------------------------------------------------------------------

old_block = r"""      const register = await request(srv.baseUrl)
        .post('/api/auth/register')
        .set(srv.headers)
        .send({ email, password });

      expect([200, 201, 302, 303]).toContain(register.status);

      const login = await request(srv.baseUrl)
        .post('/api/auth/login')
        .set(srv.headers)
        .send({ email, password });

      expect(login.status).toBe(200);

      const cookie = pickSidCookie(login.headers['set-cookie']);
      expect(cookie).toBeTruthy();
"""

new_block = r"""      const cookie = await registerAndLogin(srv, email, password);
"""

if old_block in t:
  t = t.replace(old_block, new_block, 1)

p.write_text(t, encoding="utf-8")
print("PATCHED:", p)
print("Step 5Q page hardening tests added.")
