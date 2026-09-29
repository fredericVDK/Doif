// Isolated manual UI test. No .env, hosted Auth, real users, or persisted data.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { PGlite } = require("@electric-sql/pglite");
const { fakeSupabase } = require("./auth-fixture");
const { createAuthHandler } = require("../lib/auth/routes");

(async () => {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;`);
  for (const file of ["migrations/001_tamagotchi.sql", "seeds/tamagotchi-starters.sql", "migrations/002_adoption.sql", "migrations/003_time_engine.sql", "migrations/004_feed.sql", "migrations/005_play.sql", "migrations/006_clean.sql", "migrations/007_sleep.sql", "migrations/008_xp_levels.sql", "migrations/009_growth_stages.sql", "migrations/010_coins.sql", "migrations/011_discoveries.sql", "migrations/012_daily_reward.sql", "migrations/013_inventory.sql", "migrations/014_shop.sql", "migrations/015_daily_quests.sql", "migrations/016_achievements.sql", "migrations/017_catch_the_crumbs.sql"]) {
    await db.exec(fs.readFileSync(path.join(__dirname, "..", file), "utf8"));
  }
  const provider = fakeSupabase({ gameDb: db });
  const env = { SUPABASE_URL: "https://supabase.example.test", SUPABASE_PUBLISHABLE_KEY: "test-public-key",
    SUPABASE_SECRET_KEY: "test-server-secret", APP_ORIGIN: "http://127.0.0.1" };
  const handle = createAuthHandler({ env, fetchImpl: provider.fetch });
  const allowed = new Set(["/auth.css", "/site-navigation.css", "/auth.js", "/analytics.js", "/adoption.css", "/adoption.js", "/pigeon-dashboard.css", "/pigeon-ui.js", "/pigeon-feed.js", "/pigeon-care.js", "/pigeon-daily-reward.js", "/pigeon-daily-quests.js", "/pigeon-achievements.js", "/pigeon-discovery.js", "/pigeon-discovery.css", "/inventory.css", "/shop.css", "/shop.js", "/crumb-game.css", "/crumb-game.js", "/pigeondex.html", "/pigeondex.js", "/pigeondex.css", "/catalog-ui.js", "/catalog-ui.css", "/pigeon-play.js", "/pigeon-clean.js", "/pigeon-sleep.js", "/assets/pigeon-hero-wide.png", "/assets/items/crumbs.svg", "/assets/items/corn.svg", "/assets/items/sunflower-seeds.svg", "/assets/items/peas.svg"]);
  const server = http.createServer((request, response) => {
    if (handle(request, response)) return;
    const route = new URL(request.url, env.APP_ORIGIN).pathname;
    if(route === "/api/breeds") {
      response.setHeader("content-type","application/json");
      response.end(JSON.stringify(require("../lib/game/discoveries").bundledCatalog()));return;
    }
    if (!allowed.has(route)) { response.writeHead(404); response.end(); return; }
    response.setHeader("content-type", route.endsWith(".css") ? "text/css" : route.endsWith(".js") ? "text/javascript" : route.endsWith(".html") ? "text/html" : route.endsWith(".svg") ? "image/svg+xml" : "image/png");
    response.end(fs.readFileSync(path.join(__dirname, "../public", route)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  env.APP_ORIGIN = `http://127.0.0.1:${server.address().port}`;
  for (const username of ["PreviewBird", "MobileBird"]) {
    const signup = await fetch(`${env.APP_ORIGIN}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json", origin: env.APP_ORIGIN },
      body: JSON.stringify({ username, email: `${username}@example.test`, password: "preview only password" }) });
    if (process.argv.includes("--dashboard")) {
      const { user } = await signup.json();
      const mobile = username === "MobileBird";
      await db.query("SELECT * FROM public.adopt_game_pigeon($1,$2,$3)",
        [user.id, mobile ? "australian saddleback tumbler" : "jacobin pigeon", mobile ? "Pip" : "Gilbert"]);
      await db.query(`UPDATE public.game_pigeons SET health=$2, hunger=$3, happiness=$4,
        energy=$5, cleanliness=$6, xp=27 WHERE user_id=$1`, [user.id, mobile ? 23 : 95, mobile ? 0 : 80.25, mobile ? 29 : 72, mobile ? 5 : 54, mobile ? 0 : 45]);
      if (process.argv.includes("--level-up")) {
        await db.query("UPDATE public.game_pigeons SET xp=95 WHERE user_id=$1", [user.id]);
      }
      if (process.argv.includes("--growth")) {
        await db.query("UPDATE public.game_pigeons SET level=$2,xp=$3 WHERE user_id=$1", [user.id,mobile ? 24 : 4,mobile ? 2395 : 395]);
      }
      await db.query("UPDATE public.game_users SET coins=48 WHERE id=$1", [user.id]);
      await db.query(`INSERT INTO public.game_user_items(user_id,item_id,quantity) VALUES
        ($1,$2,$3),($1,$4,$5)`,[user.id,mobile ? "peas" : "corn",mobile ? 3 : 2,mobile ? "crumbs" : "sunflower_seeds",mobile ? 1 : 1]);
      if (process.argv.includes("--away-48")) {
        await db.query(`UPDATE public.game_pigeons SET hunger=100, happiness=100, energy=100,
          cleanliness=100, health=100, created_at=now()-interval '49 hours',
          last_updated=now()-interval '48 hours' WHERE user_id=$1`, [user.id]);
      }
    }
  }
  console.log(`Isolated adoption preview: ${env.APP_ORIGIN}/sign-in`);
  console.log("Test login: PreviewBird@example.test or MobileBird@example.test / preview only password");
})().catch(error => { console.error(error); process.exit(1); });
