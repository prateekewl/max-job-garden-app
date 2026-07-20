(function bootstrapPrivateAccess() {
  "use strict";

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  const params = new URLSearchParams(hash);
  const access = params.get("access");
  const api = params.get("api");
  const person = params.get("for");

  if (access) window.localStorage.setItem("mjg:access", access);
  if (api && /^https:\/\/script\.google\.com\/macros\/s\//.test(api)) {
    window.localStorage.setItem("mjg:api", api);
  }
  if (person) window.localStorage.setItem("mjg:person-hint", person);

  if (access || api || person) {
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }
})();
