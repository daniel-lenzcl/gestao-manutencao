const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
}

const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const demoUsers = [
  {
    email: process.env.DEMO_USER_1_EMAIL || "demo.proprietario@example.com",
    password: process.env.DEMO_USER_1_PASSWORD || "Troque-Esta-Senha-01!",
    displayName: "Usuario demonstracao 1",
    buildings: [
      { name: "Casa geminada A", referenceCode: "CG-A" },
      { name: "Casa geminada B", referenceCode: "CG-B" },
    ],
  },
  {
    email: process.env.DEMO_USER_2_EMAIL || "demo.gestor@example.com",
    password: process.env.DEMO_USER_2_PASSWORD || "Troque-Esta-Senha-02!",
    displayName: "Usuario demonstracao 2",
    buildings: [
      { name: "Casa geminada C", referenceCode: "CG-C" },
    ],
  },
];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.text();
  const data = body ? JSON.parse(body) : null;

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }

  return data;
}

async function findOrCreateUser(user) {
  const list = await request("/auth/v1/admin/users?per_page=1000", {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const existing = list.users?.find(
    (candidate) => candidate.email?.toLowerCase() === user.email.toLowerCase(),
  );

  if (existing) {
    return request(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        password: user.password,
        email_confirm: true,
        user_metadata: { display_name: user.displayName },
      }),
    });
  }

  return request("/auth/v1/admin/users", {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    }),
  });
}

async function signIn(user) {
  return request("/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: user.email,
      password: user.password,
    }),
  });
}

async function rpc(accessToken, functionName, payload = {}) {
  return request(`/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

for (const user of demoUsers) {
  const authUser = await findOrCreateUser(user);
  const session = await signIn(user);
  const modelId = await rpc(
    session.access_token,
    "create_townhouse_demo_model",
  );

  for (const building of user.buildings) {
    try {
      await rpc(session.access_token, "create_building_from_model", {
        p_model_id: modelId,
        p_name: building.name,
        p_reference_code: building.referenceCode,
      });
    } catch (error) {
      if (!String(error.message).includes("buildings_owner_reference_key")) {
        throw error;
      }
    }
  }

  console.log(
    `${authUser.email}: modelo ${modelId}, ${user.buildings.length} edificacao(oes) de exemplo.`,
  );
}
