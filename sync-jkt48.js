// 48ZONE OFFICIAL
// JKT48 -> Supabase Sync
// File: sync-jkt48.js

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset."
  );
}

const JKT48_BASE = "https://jkt48.com";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

function cleanText(value) {
  if (!value) return "";

  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return cleanText(value);
}

function absoluteUrl(url) {
  if (!url) return null;

  if (url.startsWith("http://")) return url;
  if (url.startsWith("https://")) return url;

  if (url.startsWith("//")) {
    return "https:" + url;
  }

  if (url.startsWith("/")) {
    return JKT48_BASE + url;
  }

  return JKT48_BASE + "/" + url;
}

function normalizeDate(value) {
  if (!value) return null;

  const text = String(value).trim();

  let match = text.match(
    /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/
  );

  if (match) {
    return `${match[1]}-${String(match[2]).padStart(
      2,
      "0"
    )}-${String(match[3]).padStart(2, "0")}`;
  }

  match = text.match(
    /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/
  );

  if (match) {
    return `${match[3]}-${String(match[2]).padStart(
      2,
      "0"
    )}-${String(match[1]).padStart(2, "0")}`;
  }

  return null;
}

function normalizeTime(value) {
  if (!value) return null;

  const match = String(value).match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) return null;

  return `${String(match[1]).padStart(2, "0")}:${match[2]}:${match[3] || "00"}`;
}

async function fetchHtml(url) {
  console.log("FETCH:", url);

  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
  });

  console.log("STATUS:", response.status, url);

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `JKT48 HTTP ${response.status} untuk ${url}\n` +
      body.slice(0, 500)
    );
  }

  return await response.text();
}

function extractShowLinks(html) {
  const links = new Set();

  const patterns = [
    /href=["']([^"']*purchase\/schedule\/show\?code=[^"']+)["']/gi,
    /href=["']([^"']*theater-show[^"']+)["']/gi,
    /href=["']([^"']*schedule\/show[^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const url = absoluteUrl(match[1]);

      if (url) {
        links.add(url);
      }
    }
  }

  return [...links];
}

function extractCodeFromUrl(url) {
  if (!url) return null;

  const match = url.match(
    /[?&]code=([A-Za-z0-9_-]+)/i
  );

  if (match) return match[1];

  const match2 = url.match(
    /\/(?:theater-show|shows?)\/([A-Za-z0-9_-]+)/i
  );

  return match2 ? match2[1] : null;
}

function extractMeta(html, names) {
  for (const name of names) {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );

    const match = html.match(pattern);

    if (match) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

function extractTitle(html) {
  const ogTitle = extractMeta(html, [
    "og:title",
    "twitter:title",
  ]);

  if (ogTitle) {
    return ogTitle
      .replace(/\s*\|\s*JKT48.*$/i, "")
      .trim();
  }

  const titleMatch = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (titleMatch) {
    return decodeHtml(titleMatch[1])
      .replace(/\s*\|\s*JKT48.*$/i, "")
      .trim();
  }

  return null;
}

function extractImage(html) {
  const image = extractMeta(html, [
    "og:image",
    "twitter:image",
  ]);

  if (image) {
    return absoluteUrl(image);
  }

  const imageMatch = html.match(
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i
  );

  if (imageMatch) {
    return absoluteUrl(imageMatch[1]);
  }

  return null;
}

function extractDate(html) {
  const patterns = [
    /(\d{4}-\d{2}-\d{2})/g,
    /(\d{2}\/\d{2}\/\d{4})/g,
    /(\d{2}-\d{2}-\d{4})/g,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(html);

    if (match) {
      const date = normalizeDate(match[1]);

      if (date) return date;
    }
  }

  return null;
}

function extractTime(html) {
  const matches = [
    ...html.matchAll(
      /(?:^|[\s>])(\d{1,2}:\d{2})(?::\d{2})?(?:[\s<]|$)/g
    ),
  ];

  for (const match of matches) {
    const time = normalizeTime(match[1]);

    if (time) return time;
  }

  return null;
}

function extractTeam(html) {
  const text = cleanText(html);

  const teams = [
    "TEAM J",
    "TEAM KIII",
    "TEAM K3",
    "TEAM T",
    "TEAM JKT48",
    "TRAINEE",
    "DREAM",
    "LOVE",
    "PASSION",
  ];

  for (const team of teams) {
    if (
      new RegExp(`\\b${team.replace(" ", "\\s+")}\\b`, "i").test(
        text
      )
    ) {
      return team;
    }
  }

  return null;
}

function extractDescription(html) {
  const description = extractMeta(html, [
    "description",
    "og:description",
  ]);

  return description || "";
}

function extractMemberNames(html) {
  const members = new Set();

  const patterns = [
    /data-member-name=["']([^"']+)["']/gi,
    /data-name=["']([^"']+)["']/gi,
    /member-name[^>]*>([\s\S]*?)<\//gi,
  ];

  for (const pattern of patterns) {
    let match;

    while ((match = pattern.exec(html)) !== null) {
      const name = cleanText(match[1]);

      if (
        name &&
        name.length >= 2 &&
        name.length <= 80 &&
        !/member|anggota/i.test(name)
      ) {
        members.add(name);
      }
    }
  }

  return [...members];
}

function parseShowDetail(html, url, code) {
  const title = extractTitle(html);

  const date = extractDate(html);

  const time = extractTime(html);

  const image = extractImage(html);

  const team = extractTeam(html);

  const description = extractDescription(html);

  const memberNames = extractMemberNames(html);

  return {
    external_id: code,
    name: title || `JKT48 Show ${code}`,
    show_date: date,
    show_time: time,
    team,
    description,
    image_url: image,
    source_url: url,
    member_names: memberNames,
  };
}

async function getSchedulePages() {
  const now = new Date();

  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const nextDate = new Date(
    year,
    month,
    1
  );

  const nextYear = nextDate.getFullYear();
  const nextMonth = nextDate.getMonth() + 1;

  const urls = [
    `${JKT48_BASE}/schedule?month=${month}&type=SHOW&year=${year}`,
    `${JKT48_BASE}/schedule?month=${nextMonth}&type=SHOW&year=${nextYear}`,
  ];

  const pages = [];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);

      pages.push({
        url,
        html,
      });
    } catch (error) {
      console.error(
        "Gagal mengambil schedule:",
        error.message
      );
    }
  }

  return pages;
}

async function getShows() {
  const pages = await getSchedulePages();

  const links = new Set();

  for (const page of pages) {
    const found = extractShowLinks(page.html);

    console.log(
      `Ditemukan ${found.length} link show dari ${page.url}`
    );

    for (const link of found) {
      links.add(link);
    }
  }

  console.log(
    "TOTAL LINK SHOW:",
    links.size
  );

  const shows = [];

  for (const url of links) {
    const code = extractCodeFromUrl(url);

    if (!code) {
      console.log(
        "Lewati link tanpa code:",
        url
      );

      continue;
    }

    try {
      const html = await fetchHtml(url);

      const show = parseShowDetail(
        html,
        url,
        code
      );

      console.log(
        "SHOW:",
        show.name,
        show.show_date,
        show.show_time,
        show.team
      );

      shows.push(show);
    } catch (error) {
      console.error(
        "Gagal detail show:",
        code,
        error.message
      );
    }
  }

  return shows;
}

async function supabaseRequest(
  table,
  options = {}
) {
  const url =
    `${SUPABASE_URL}/rest/v1/${table}` +
    (options.query || "");

  const response = await fetch(url, {
    method: options.method || "GET",

    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization:
        `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type":
        "application/json",
      Prefer:
        options.prefer ||
        "return=representation",
    },

    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function upsertMember(name) {
  const externalId =
    "member-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const existing = await supabaseRequest(
    "members",
    {
      query:
        `?external_id=eq.${encodeURIComponent(
          externalId
        )}&select=id`,
    }
  );

  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    return existing[0].id;
  }

  const result = await supabaseRequest(
    "members",
    {
      method: "POST",
      body: {
        external_id: externalId,
        name,
        active: true,
      },
    }
  );

  return Array.isArray(result)
    ? result[0]?.id
    : null;
}

async function upsertShow(show) {
  const existing = await supabaseRequest(
    "shows",
    {
      query:
        `?external_id=eq.${encodeURIComponent(
          show.external_id
        )}&select=id,price`,
    }
  );

  let price = 25000;

  if (
    Array.isArray(existing) &&
    existing.length > 0 &&
    Number.isFinite(existing[0].price)
  ) {
    price = existing[0].price;
  }

  const body = {
    external_id: show.external_id,
    name: show.name,
    show_date: show.show_date,
    show_time: show.show_time,
    team: show.team,
    description: show.description,
    image_url: show.image_url,
    price,
    active: true,
    source_url: show.source_url,
    source_updated_at:
      new Date().toISOString(),
    updated_at:
      new Date().toISOString(),
  };

  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    const id = existing[0].id;

    await supabaseRequest(
      "shows",
      {
        method: "PATCH",
        query: `?id=eq.${id}`,
        body,
      }
    );

    return id;
  }

  const result = await supabaseRequest(
    "shows",
    {
      method: "POST",
      body: {
        ...body,
        created_at:
          new Date().toISOString(),
      },
    }
  );

  return Array.isArray(result)
    ? result[0]?.id
    : null;
}

async function syncShow(show) {
  const showId =
    await upsertShow(show);

  if (!showId) {
    throw new Error(
      `Gagal mendapatkan ID show ${show.external_id}`
    );
  }

  await supabaseRequest(
    "show_members",
    {
      method: "DELETE",
      query:
        `?show_id=eq.${showId}`,
      prefer: "return=minimal",
    }
  );

  let sortOrder = 0;

  for (const memberName of show.member_names) {
    try {
      const memberId =
        await upsertMember(memberName);

      if (!memberId) continue;

      await supabaseRequest(
        "show_members",
        {
          method: "POST",
          body: {
            show_id: showId,
            member_id: memberId,
            sort_order: sortOrder++,
          },
          prefer: "return=minimal",
        }
      );
    } catch (error) {
      console.error(
        "Gagal sync member:",
        memberName,
        error.message
      );
    }
  }

  return showId;
}

async function deactivateOldShows(activeExternalIds) {
  if (
    !activeExternalIds ||
    activeExternalIds.size === 0
  ) {
    return;
  }

  const existing =
    await supabaseRequest(
      "shows",
      {
        query:
          "?select=id,external_id&active=eq.true",
      }
    );

  if (!Array.isArray(existing)) return;

  for (const show of existing) {
    if (
      show.external_id &&
      !activeExternalIds.has(
        show.external_id
      )
    ) {
      try {
        await supabaseRequest(
          "shows",
          {
            method: "PATCH",
            query:
              `?id=eq.${show.id}`,
            body: {
              active: false,
              updated_at:
                new Date().toISOString(),
            },
            prefer:
              "return=minimal",
          }
        );
      } catch (error) {
        console.error(
          "Gagal menonaktifkan show:",
          show.external_id,
          error.message
        );
      }
    }
  }
}

async function main() {
  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "48ZONE - JKT48 SYNC START"
  );
  console.log(
    "======================================"
  );
  console.log("");

  const shows = await getShows();

  if (!shows.length) {
    throw new Error(
      "Tidak menemukan show JKT48."
    );
  }

  console.log("");
  console.log(
    "SHOW SIAP DISIMPAN:",
    shows.length
  );
  console.log("");

  const activeExternalIds =
    new Set();

  let synced = 0;
  let failed = 0;

  for (const show of shows) {
    try {
      await syncShow(show);

      activeExternalIds.add(
        show.external_id
      );

      synced++;

      console.log(
        `OK ${synced}: ${show.name}`
      );
    } catch (error) {
      failed++;

      console.error(
        `GAGAL: ${show.external_id}`,
        error.message
      );
    }
  }

  await deactivateOldShows(
    activeExternalIds
  );

  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "48ZONE - JKT48 SYNC SELESAI"
  );
  console.log(
    "======================================"
  );
  console.log(
    "Total ditemukan :",
    shows.length
  );
  console.log(
    "Berhasil        :",
    synced
  );
  console.log(
    "Gagal           :",
    failed
  );
  console.log(
    "======================================"
  );

  if (failed > 0 && synced === 0) {
    throw new Error(
      "Semua show gagal disimpan ke Supabase."
    );
  }
}

main().catch((error) => {
  console.error("");
  console.error(
    "SYNC ERROR:"
  );
  console.error(
    error.message
  );
  process.exit(1);
});
