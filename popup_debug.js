function extractListingAdIdFromUrl(url) {
  const match = String(url || "").match(/listing\/[^/]*-(\d+)/);
  return match ? Number(match[1]) : null;
}

async function runPopupDebug() {
  const urlEl = document.getElementById("fullTabUrl");
  const idEl = document.getElementById("derivedListingAdId");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      urlEl.textContent = "No active tab";
      idEl.textContent = "N/A";
      return;
    }

    // ✅ FULL URL — exactly what Chrome sees
    urlEl.textContent = tab.url || "(empty URL)";

    // Derived ID (same regex logic as popup.js)
    const derivedId = extractListingAdIdFromUrl(tab.url);
    idEl.textContent = derivedId ? String(derivedId) : "Not found";
  } catch (e) {
    console.error("[popup_debug] error", e);
    urlEl.textContent = "Error reading URL";
    idEl.textContent = "Error";
  }
}

document.addEventListener("DOMContentLoaded", runPopupDebug);
