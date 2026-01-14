// popup.js (ES module)
import { FALLBACK_API_RESPONSE } from "./fallback_data.js";

const API_URL = "https://dev.apis.datascience.tilabs.io/recommendation_engine";
const TRANSPARENT_PIXEL_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function buildListingUrl(listingAdId) {
  // Note: if you want exact slug URL, you need slug too.
  // This works for linking and RVTrader usually redirects as needed.
  return `https://www.rvtrader.com/listing/${encodeURIComponent(listingAdId)}`;
}

function normalizeUrl(value, baseUrl) {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function getMetaContent(doc, selector) {
  const el = doc.querySelector(selector);
  const value = el?.getAttribute("content")?.trim();
  return value || null;
}

function formatPrice(value, currency = "USD") {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const amount = Number(raw);
    if (!Number.isFinite(amount)) return raw;
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      return `$${amount.toLocaleString("en-US")}`;
    }
  }
  return raw;
}

function extractFromJsonLd(json) {
  if (!json) return {};
  const items = [];
  if (Array.isArray(json)) items.push(...json);
  else if (Array.isArray(json["@graph"])) items.push(...json["@graph"]);
  else items.push(json);

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const image = Array.isArray(item.image) ? item.image[0] : item.image;
    const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;

    const price = offers?.price ?? offers?.lowPrice ?? offers?.priceSpecification?.price;
    const priceCurrency = offers?.priceCurrency ?? offers?.priceSpecification?.priceCurrency;

    // Best-effort “name” + seller + address
    const name = item.name || null;
    const seller = item.seller?.name || item.brand?.name || null;

    const addressLocality =
      item.offers?.availableAtOrFrom?.address?.addressLocality ||
      item.address?.addressLocality ||
      null;

    const addressRegion =
      item.offers?.availableAtOrFrom?.address?.addressRegion ||
      item.address?.addressRegion ||
      null;

    if (image || price || name || seller || addressLocality || addressRegion) {
      return { image, price, priceCurrency, name, seller, addressLocality, addressRegion };
    }
  }
  return {};
}

function parseListingDetailsFromHtml(html, listingUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  const metaImage =
    getMetaContent(doc, 'meta[property="og:image:secure_url"]') ||
    getMetaContent(doc, 'meta[property="og:image"]') ||
    getMetaContent(doc, 'meta[name="twitter:image"]');

  const metaTitle =
    getMetaContent(doc, 'meta[property="og:title"]') ||
    getMetaContent(doc, 'meta[name="twitter:title"]');

  const metaPrice =
    getMetaContent(doc, 'meta[property="product:price:amount"]') ||
    getMetaContent(doc, 'meta[property="og:price:amount"]') ||
    getMetaContent(doc, 'meta[property="og:price"]');

  const metaCurrency =
    getMetaContent(doc, 'meta[property="product:price:currency"]') ||
    getMetaContent(doc, 'meta[property="og:price:currency"]');

  let jsonLd = {};
  const jsonLdScripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of jsonLdScripts) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text);
      const extracted = extractFromJsonLd(parsed);
      jsonLd = { ...jsonLd, ...extracted };
      if (jsonLd.image && (jsonLd.price ?? metaPrice) && (jsonLd.name || metaTitle)) break;
    } catch {
      // ignore invalid json-ld blocks
    }
  }

  const imageUrl = normalizeUrl(metaImage || jsonLd.image, listingUrl);

  const currency = metaCurrency || jsonLd.priceCurrency || "USD";
  const priceText = formatPrice(metaPrice ?? jsonLd.price, currency);

  const title = (metaTitle || jsonLd.name || "").trim() || null;

  const city = jsonLd.addressLocality || null;
  const state = jsonLd.addressRegion || null;
  const dealer = jsonLd.seller || null;

  const locationText =
    city && state ? `${city}, ${state}` :
    state ? state :
    null;

  return { imageUrl, priceText, title, locationText, dealer };
}

async function fetchListingDetails(listingAdId) {
  const listingUrl = buildListingUrl(listingAdId);
  const response = await fetch(listingUrl, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Listing fetch status ${response.status}`);
  const html = await response.text();
  return parseListingDetailsFromHtml(html, listingUrl);
}

function pill(text, kind = "") {
  const cls = kind ? `pill ${kind}` : "pill";
  return `<span class="${cls}">${text}</span>`;
}

function setMeta({ anchorId, userZip, apiStatus, note }) {
  const meta = document.getElementById("meta");
  const parts = [];
  if (anchorId) parts.push(pill(`Anchor: ${anchorId}`));
  if (userZip) parts.push(pill(`ZIP: ${userZip}`));
  if (apiStatus) {
    parts.push(
      apiStatus === "ok"
        ? pill("API: OK", "ok")
        : apiStatus === "unauthorized"
          ? pill("API: Unauthorized (local)", "warn")
          : pill("API: Error (local)", "warn")
    );
  }
  if (note) parts.push(pill(note));
  meta.innerHTML = parts.join(" ");
}

function showError(message) {
  const report = document.getElementById("report");
  report.className = "";
  report.innerHTML = `<div class="error">${message}</div>`;
}

function renderVerticalCards(recommendations) {
  const report = document.getElementById("report");
  report.className = "";
  report.innerHTML = "";

  if (!Array.isArray(recommendations) || recommendations.length === 0) {
    report.innerHTML = `<div class="error">No recommendations found.</div>`;
    return;
  }

  const top = recommendations.slice(0, 20);

  top.forEach((rec, idx) => {
    const id = rec.listing_ad_id;
    const url = buildListingUrl(id);

    const card = document.createElement("div");
    card.className = "card";

    const imgWrap = document.createElement("div");
    imgWrap.className = "img-wrap";

    const img = document.createElement("img");
    img.className = "img";
    img.alt = `Listing ${id}`;
    img.src = TRANSPARENT_PIXEL_GIF;
    img.loading = "lazy";

    const badges = document.createElement("div");
    badges.className = "badges";

    const b1 = document.createElement("div");
    b1.className = "badge";
    b1.textContent = "Recommended";

    const b2 = document.createElement("div");
    b2.className = "badge";
    b2.textContent = `#${idx + 1} • ${id}`;

    badges.appendChild(b1);
    badges.appendChild(b2);

    imgWrap.appendChild(img);
    imgWrap.appendChild(badges);

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("div");
    title.className = "title";
    title.textContent = "Loading title…";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span class="muted">Loading location…</span>`;

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = "Loading price…";

    const btn = document.createElement("a");
    btn.className = "btn";
    btn.href = url;
    btn.target = "_blank";
    btn.rel = "noopener noreferrer";
    btn.textContent = "View details";

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(price);
    body.appendChild(btn);

    card.appendChild(imgWrap);
    card.appendChild(body);

    report.appendChild(card);

    // Enrich with listing details (best-effort)
    void (async () => {
      try {
        const details = await fetchListingDetails(id);

        if (details.imageUrl) img.src = details.imageUrl;
        title.textContent = details.title || `Listing ${id}`;

        const pieces = [];
        if (details.locationText) pieces.push(details.locationText);
        if (details.dealer) pieces.push(details.dealer);
        meta.textContent = pieces.length ? pieces.join(" • ") : `Ad ID: ${id}`;

        price.textContent = details.priceText || "Price unavailable";
      } catch (e) {
        console.warn("Details fetch failed:", id, e);
        title.textContent = `Listing ${id}`;
        meta.textContent = `Ad ID: ${id}`;
        price.textContent = "Price unavailable";
      }
    })();
  });
}

async function getListingContext(tabId) {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const m = location.href.match(/\/listing\/[^/]*-(\d+)(?:[/?#]|$)/i);
      const listing_ad_id = m ? Number(m[1]) : null;

      // Best-effort ZIP extraction (structured only; may be null)
      const fromNext = () => {
        const el = document.getElementById("__NEXT_DATA__");
        if (!el?.textContent) return null;
        try {
          const data = JSON.parse(el.textContent);
          const s = JSON.stringify(data);
          const m1 = s.match(/"postalCode"\s*:\s*"(\d{5})"/);
          if (m1) return Number(m1[1]);
          const m2 = s.match(/"zip"\s*:\s*"(\d{5})"/i);
          if (m2) return Number(m2[1]);
          return null;
        } catch {
          return null;
        }
      };

      return { listing_ad_id, user_zip: fromNext() };
    }
  });

  return injected?.result || {};
}

async function fetchRecommendationsOrLocalFallback(payload) {
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      console.warn("Unauthorized: using local fallback response.");
      return { data: structuredClone(FALLBACK_API_RESPONSE), apiStatus: "unauthorized" };
    }

    if (!response.ok) {
      console.warn("API error:", response.status, "using local fallback response.");
      return { data: structuredClone(FALLBACK_API_RESPONSE), apiStatus: "error" };
    }

    const data = await response.json();
    return { data, apiStatus: "ok" };
  } catch (e) {
    console.warn("API fetch failed:", e, "using local fallback response.");
    return { data: structuredClone(FALLBACK_API_RESPONSE), apiStatus: "error" };
  }
}

async function load() {
  const report = document.getElementById("report");
  report.className = "loading";
  report.textContent = "Loading…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showError("No active tab found.");
    return;
  }

  const ctx = await getListingContext(tab.id);
  const listing_ad_id = ctx.listing_ad_id;

  // If zip can't be derived from page, use fallback zip from local response
  const user_zip = ctx.user_zip || FALLBACK_API_RESPONSE.user_zip || 94107;

  if (!listing_ad_id) {
    setMeta({ anchorId: null, userZip: user_zip, apiStatus: null, note: "Not a listing page" });
    showError("Open an RVTrader listing page and try again.");
    return;
  }

  const payload = { listing_ad_id, user_zip, radius_mi: 500, k: 20 };

  const { data, apiStatus } = await fetchRecommendationsOrLocalFallback(payload);

  // Ensure output stays in the same format as API and matches current context
  data.anchor_id = listing_ad_id;
  data.user_zip = user_zip;
  data.radius_mi = 500;
  data.version = data.version || "v1.0.0";

  setMeta({
    anchorId: data.anchor_id,
    userZip: data.user_zip,
    apiStatus,
    note: `Ver ${data.version}`
  });

  renderVerticalCards(data.recommendations || []);
}

document.addEventListener("DOMContentLoaded", () => {
  load().catch((e) => {
    console.error("Fatal:", e);
    showError(e?.message || String(e));
  });
});
