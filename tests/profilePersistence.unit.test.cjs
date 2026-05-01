'use strict';

const {
  updateMyProfileJson,
  getMyProfileJson,
} = require('../src/modules/profile/profile.controller.cjs');

function createJsonRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    },
  };
}

function createProfileDb() {
  const state = {
    profile: null,
    queries: [],
  };

  return {
    state,
    async query(sql, params) {
      state.queries.push({ sql, params });

      if (/FROM user_profiles/i.test(sql) && /WHERE user_id = \$1/i.test(sql) && !/INSERT INTO user_profiles/i.test(sql)) {
        return {
          rows: state.profile ? [state.profile] : [],
        };
      }

      if (/INSERT INTO user_profiles/i.test(sql)) {
        const [userId, fullName, nickname, about, publicEmail] = params;

        state.profile = {
          user_id: userId,
          full_name: fullName,
          nickname,
          about,
          public_email: publicEmail || null,
          updated_at: new Date('2026-05-01T00:00:00.000Z'),
        };

        return {
          rows: [state.profile],
        };
      }

      throw new Error(`Unexpected SQL in profile persistence test: ${sql}`);
    },
  };
}

describe('profile persistence API', () => {
  test('POST /api/profile upserts full_name, nickname and about for req.userId', async () => {
    const db = createProfileDb();

    const req = {
      userId: 42,
      app: {
        locals: {
          db,
        },
      },
      body: {
        full_name: 'Alex Tempasi',
        nickname: 'Alex_Tempasi',
        about: 'I create exclusive website templates.',
      },
    };

    const res = createJsonRes();

    await updateMyProfileJson(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      profile: {
        full_name: 'Alex Tempasi',
        nickname: 'alex_tempasi',
        about: 'I create exclusive website templates.',
      },
    });

    expect(db.state.profile).toMatchObject({
      user_id: 42,
      full_name: 'Alex Tempasi',
      nickname: 'alex_tempasi',
      about: 'I create exclusive website templates.',
    });
  });

  test('POST /api/profile accepts empty optional public_email', async () => {
    const db = createProfileDb();

    const req = {
      userId: 43,
      app: {
        locals: {
          db,
        },
      },
      body: {
        full_name: 'Optional Email User',
        nickname: 'optional-email',
        about: 'Profile without public email.',
        public_email: '',
      },
    };

    const res = createJsonRes();

    await updateMyProfileJson(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      profile: {
        full_name: 'Optional Email User',
        nickname: 'optional-email',
        about: 'Profile without public email.',
        public_email: null,
      },
    });
  });

  test('POST /api/profile rejects invalid optional public_email when filled', async () => {
    const db = createProfileDb();

    const req = {
      userId: 44,
      app: {
        locals: {
          db,
        },
      },
      body: {
        full_name: 'Invalid Email User',
        nickname: 'invalid-email',
        about: 'Profile with invalid public email.',
        public_email: 'not-an-email',
      },
    };

    const res = createJsonRes();

    await updateMyProfileJson(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({
      error: 'PROFILE_VALIDATION_FAILED',
    });
    expect(res.payload.details).toEqual(expect.arrayContaining([
      'public_email must be a valid email address',
    ]));
  });

  test('POST /api/profile rejects missing required profile fields', async () => {
    const db = createProfileDb();

    const req = {
      userId: 42,
      app: {
        locals: {
          db,
        },
      },
      body: {
        full_name: '',
        nickname: '',
        about: '',
      },
    };

    const res = createJsonRes();

    await updateMyProfileJson(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({
      error: 'PROFILE_VALIDATION_FAILED',
    });
    expect(res.payload.details).toEqual(expect.arrayContaining([
      'full_name is required',
      'nickname is required',
      'about is required',
    ]));
  });

  test('GET /api/profile returns the profile saved for the same authenticated user', async () => {
    const db = createProfileDb();

    await updateMyProfileJson(
      {
        userId: 77,
        app: { locals: { db } },
        body: {
          full_name: 'Saved User',
          nickname: 'saved-user',
          about: 'Persisted profile text.',
          public_email: 'public-seller@example.com',
          public_email: 'public-seller@example.com',
          public_email: 'public-seller@example.com',
        },
      },
      createJsonRes(),
    );

    const res = createJsonRes();

    await getMyProfileJson(
      {
        userId: 77,
        app: { locals: { db } },
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      profile: {
        full_name: 'Saved User',
        nickname: 'saved-user',
        about: 'Persisted profile text.',
      },
    });
  });
});
