// ============================================================
// 48ZONE OFFICIAL
// JKT48 API -> Supabase
// File: sync-jkt48.js
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("SUPABASE_URL belum tersedia.");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY belum tersedia."
  );
}

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------

const JKT48_API =
  "https://jkt48.com/api/v1";

const JKT48_HEADERS = {
  "Accept": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36",
  "Accept-Language":
    "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
};

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}

function safe(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  return String(value).trim();
}

function makeExternalId(code, date, scheduleId) {
  if (code && date) {
    return `${code}-${date}`;
  }

  if (scheduleId) {
    return `schedule-${scheduleId}`;
  }

  return null;
}

// ------------------------------------------------------------
// JKT48 API
// ------------------------------------------------------------

async function jkt48Request(endpoint) {
  const url =
    `${JKT48_API}${endpoint}`;

  console.log("");
  console.log("JKT48 REQUEST:");
  console.log(url);

  const response = await fetch(url, {
    method: "GET",
    headers: JKT48_HEADERS,
    redirect: "follow"
  });

  const text =
    await response.text();

  console.log(
    "JKT48 STATUS:",
    response.status
  );

  if (!response.ok) {
    console.error(
      "JKT48 RESPONSE:"
    );

    console.error(
      text.slice(0, 1000)
    );

    throw new Error(
      `JKT48 API HTTP ${response.status}`
    );
  }

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      "Response JKT48 bukan JSON."
    );
  }

  return json;
}

// ------------------------------------------------------------
// GET SCHEDULE
// ------------------------------------------------------------

async function getSchedulesForMonth(
  year,
  month
) {
  const endpoint =
    `/schedules?lang=id&month=${month}&year=${year}&type=SHOW`;

  const result =
    await jkt48Request(endpoint);

  if (!result) {
    return [];
  }

  if (
    Array.isArray(result.data)
  ) {
    return result.data;
  }

  if (
    result.data &&
    Array.isArray(result.data.data)
  ) {
    return result.data.data;
  }

  return [];
}

async function getSchedules() {
  const now = new Date();

  const currentYear =
    now.getFullYear();

  const currentMonth =
    now.getMonth() + 1;

  const nextDate = new Date(
    currentYear,
    currentMonth,
    1
  );

  const nextYear =
    nextDate.getFullYear();

  const nextMonth =
    nextDate.getMonth() + 1;

  console.log("");
  console.log(
    "AMBIL JADWAL:",
    `${currentMonth}/${currentYear}`
  );

  console.log(
    "DAN:",
    `${nextMonth}/${nextYear}`
  );

  const all = [];

  const months = [
    {
      year: currentYear,
      month: currentMonth
    },
    {
      year: nextYear,
      month: nextMonth
    }
  ];

  for (const item of months) {
    try {
      const rows =
        await getSchedulesForMonth(
          item.year,
          item.month
        );

      console.log(
        `JADWAL ${item.month}/${item.year}:`,
        rows.length
      );

      all.push(...rows);
    } catch (error) {
      console.error(
        `GAGAL JADWAL ${item.month}/${item.year}:`,
        error.message
      );
    }
  }

  // Hapus duplikat
  const unique =
    new Map();

  for (const row of all) {
    const key =
      row.schedule_id ||
      `${row.reference_code}-${row.date}-${row.start_time}`;

    if (!unique.has(key)) {
      unique.set(key, row);
    }
  }

  const result =
    [...unique.values()];

  console.log("");
  console.log(
    "TOTAL JADWAL UNIK:",
    result.length
  );

  return result;
}

// ------------------------------------------------------------
// GET DETAIL SHOW
// ------------------------------------------------------------

async function getShowDetail(code) {
  if (!code) {
    return null;
  }

  const endpoint =
    `/theater-shows/${encodeURIComponent(
      code
    )}?lang=id`;

  try {
    const result =
      await jkt48Request(endpoint);

    if (
      result &&
      result.data
    ) {
      return result.data;
    }

    return result;
  } catch (error) {
    console.error(
      "DETAIL SHOW GAGAL:",
      code,
      error.message
    );

    return null;
  }
}

// ------------------------------------------------------------
// SUPABASE
// ------------------------------------------------------------

async function supabaseRequest(
  table,
  options = {}
) {
  const query =
    options.query || "";

  const url =
    `${SUPABASE_URL}/rest/v1/${table}${query}`;

  const response =
    await fetch(url, {
      method:
        options.method || "GET",

      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,

        "Content-Type":
          "application/json",

        Prefer:
          options.prefer ||
          "return=representation"
      },

      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(
              options.body
            )
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  if (!text) {
    return [];
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ------------------------------------------------------------
// MEMBER
// ------------------------------------------------------------

function makeMemberExternalId(
  member
) {
  if (
    member.member_id !== undefined &&
    member.member_id !== null
  ) {
    return `jkt48-${member.member_id}`;
  }

  const name =
    safe(member.name) || "unknown";

  return (
    "jkt48-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

async function syncMember(
  member
) {
  const name =
    safe(member.name);

  if (!name) {
    return null;
  }

  const externalId =
    makeMemberExternalId(member);

  const existing =
    await supabaseRequest(
      "members",
      {
        query:
          `?external_id=eq.${encodeURIComponent(
            externalId
          )}&select=id,image_url`
      }
    );

  const body = {
    external_id:
      externalId,

    name,

    active: true,

    updated_at:
      new Date().toISOString()
  };

  // Jangan menghapus foto lama
  if (
    member.image_url
  ) {
    body.image_url =
      member.image_url;
  }

  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    const old =
      existing[0];

    if (
      !body.image_url &&
      old.image_url
    ) {
      body.image_url =
        old.image_url;
    }

    await supabaseRequest(
      "members",
      {
        method: "PATCH",

        query:
          `?id=eq.${old.id}`,

        body,

        prefer:
          "return=minimal"
      }
    );

    return old.id;
  }

  const inserted =
    await supabaseRequest(
      "members",
      {
        method: "POST",

        body,

        prefer:
          "return=representation"
      }
    );

  if (
    Array.isArray(inserted) &&
    inserted[0]
  ) {
    return inserted[0].id;
  }

  return null;
}

// ------------------------------------------------------------
// SHOW
// ------------------------------------------------------------

async function syncShow(
  schedule,
  detail
) {
  const code =
    safe(
      schedule.reference_code ||
      detail?.code
    );

  const date =
    safe(
      schedule.date ||
      detail?.date
    );

  if (!code) {
    throw new Error(
      "Show tidak mempunyai reference_code."
    );
  }

  const name =
    safe(
      detail?.title ||
      schedule.title
    ) ||
    `JKT48 Show ${code}`;

  const showTime =
    safe(
      detail?.start_time ||
      schedule.start_time
    );

  const team =
    safe(
      detail?.jkt48_member_type ||
      schedule.jkt48_member_type
    );

  const description =
    safe(
      schedule.short_description ||
      detail?.short_description ||
      ""
    );

  const imageUrl =
    safe(
      detail?.image_url ||
      detail?.image ||
      detail?.thumbnail ||
      schedule.image_url ||
      schedule.image
    );

  const sourceUrl =
    safe(
      schedule.link ||
      `https://jkt48.com/purchase/schedule/show?code=${code}`
    );

  const externalId =
    makeExternalId(
      code,
      date,
      schedule.schedule_id
    );

  if (!externalId) {
    throw new Error(
      `External ID tidak valid untuk ${name}`
    );
  }

  // Cari show lama
  const existing =
    await supabaseRequest(
      "shows",
      {
        query:
          `?external_id=eq.${encodeURIComponent(
            externalId
          )}&select=id,price`
      }
    );

  let price = 25000;

  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    if (
      existing[0].price !== null &&
      existing[0].price !== undefined
    ) {
      price =
        Number(existing[0].price);
    }
  }

  // Kalau detail punya default_price
  // jangan langsung pakai harga JKT48.
  // 48ZONE tetap memakai harga streaming.
  const body = {
    external_id:
      externalId,

    name,

    show_date:
      date || null,

    show_time:
      showTime || null,

    team:
      team || null,

    description:
      description || null,

    image_url:
      imageUrl || null,

    price,

    active: true,

    source_url:
      sourceUrl,

    source_updated_at:
      new Date().toISOString(),

    updated_at:
      new Date().toISOString()
  };

  let showId;

  if (
    Array.isArray(existing) &&
    existing.length > 0
  ) {
    showId =
      existing[0].id;

    await supabaseRequest(
      "shows",
      {
        method: "PATCH",

        query:
          `?id=eq.${showId}`,

        body,

        prefer:
          "return=minimal"
      }
    );
  } else {
    const inserted =
      await supabaseRequest(
        "shows",
        {
          method: "POST",

          body: {
            ...body,

            created_at:
              new Date().toISOString()
          }
        }
      );

    if (
      !Array.isArray(inserted) ||
      !inserted[0]
    ) {
      throw new Error(
        `Gagal insert show ${name}`
      );
    }

    showId =
      inserted[0].id;
  }

  // ----------------------------------------------------------
  // MEMBER
  // ----------------------------------------------------------

  const members =
    Array.isArray(
      detail?.jkt48_member
    )
      ? detail.jkt48_member
      : [];

  // Hapus relasi lama
  await supabaseRequest(
    "show_members",
    {
      method: "DELETE",

      query:
        `?show_id=eq.${showId}`,

      prefer:
        "return=minimal"
    }
  );

  let sortOrder = 0;

  for (
    const member of members
  ) {
    try {
      const memberId =
        await syncMember(member);

      if (!memberId) {
        continue;
      }

      await supabaseRequest(
        "show_members",
        {
          method: "POST",

          body: {
            show_id:
              showId,

            member_id:
              memberId,

            sort_order:
              sortOrder++
          },

          prefer:
            "return=minimal"
        }
      );
    } catch (error) {
      console.error(
        "MEMBER ERROR:",
        name,
        member?.name,
        error.message
      );
    }
  }

  return {
    id: showId,
    external_id:
      externalId,
    name
  };
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

async function main() {
  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "48ZONE JKT48 API SYNC"
  );
  console.log(
    "======================================"
  );

  console.log("");
  console.log(
    "Supabase:",
    SUPABASE_URL
  );

  console.log(
    "JKT48 API:",
    JKT48_API
  );

  console.log("");

  const schedules =
    await getSchedules();

  if (!schedules.length) {
    throw new Error(
      "API JKT48 tidak mengembalikan jadwal SHOW."
    );
  }

  console.log("");
  console.log(
    "JADWAL DITEMUKAN:",
    schedules.length
  );

  console.log("");

  let success = 0;
  let failed = 0;

  const activeIds =
    new Set();

  for (
    const schedule of schedules
  ) {
    const code =
      safe(
        schedule.reference_code
      );

    console.log("");
    console.log(
      "--------------------------------------"
    );

    console.log(
      "SHOW:",
      schedule.title
    );

    console.log(
      "DATE:",
      schedule.date
    );

    console.log(
      "TIME:",
      schedule.start_time
    );

    console.log(
      "CODE:",
      code
    );

    if (!code) {
      console.error(
        "SKIP: reference_code kosong"
      );

      failed++;

      continue;
    }

    try {
      const detail =
        await getShowDetail(
          code
        );

      await sleep(300);

      const result =
        await syncShow(
          schedule,
          detail || {}
        );

      activeIds.add(
        result.external_id
      );

      success++;

      console.log(
        "SYNC OK:",
        result.name
      );
    } catch (error) {
      failed++;

      console.error(
        "SYNC GAGAL:",
        schedule.title,
        error.message
      );
    }
  }

  // ----------------------------------------------------------
  // NONAKTIFKAN SHOW LAMA
  // ----------------------------------------------------------

  console.log("");
  console.log(
    "Memeriksa show lama..."
  );

  try {
    const existing =
      await supabaseRequest(
        "shows",
        {
          query:
            "?active=eq.true&select=id,external_id"
        }
      );

    if (
      Array.isArray(existing)
    ) {
      for (
        const show of existing
      ) {
        if (
          show.external_id &&
          !activeIds.has(
            show.external_id
          )
        ) {
          await supabaseRequest(
            "shows",
            {
              method: "PATCH",

              query:
                `?id=eq.${show.id}`,

              body: {
                active: false,

                updated_at:
                  new Date().toISOString()
              },

              prefer:
                "return=minimal"
            }
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "Gagal menonaktifkan show lama:",
      error.message
    );
  }

  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "SYNC SELESAI"
  );
  console.log(
    "======================================"
  );

  console.log(
    "Total:",
    schedules.length
  );

  console.log(
    "Berhasil:",
    success
  );

  console.log(
    "Gagal:",
    failed
  );

  console.log(
    "======================================"
  );

  if (
    success === 0
  ) {
    throw new Error(
      "Tidak ada show yang berhasil disimpan."
    );
  }
}

main().catch(error => {
  console.error("");
  console.error(
    "======================================"
  );
  console.error(
    "SYNC ERROR"
  );
  console.error(
    "======================================"
  );
  console.error(
    error.message
  );

  process.exit(1);
});
