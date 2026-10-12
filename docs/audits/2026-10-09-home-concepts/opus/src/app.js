/* oxlint-disable no-nested-ternary, complexity -- prototype view templates read as one expression per state. */
/* Render loop, delegated actions and keyboard. Concepts only supply the Home body. */
H.render = () => {
  const S = H.S;
  const root = document.getElementById("root");
  const active = document.activeElement;
  const focusId = active?.id;
  const sel =
    focusId && typeof active.selectionStart === "number"
      ? [active.selectionStart, active.selectionEnd]
      : null;
  const scrollTop = root.querySelector(".body")?.scrollTop || 0;
  H.compact = S.device === "mobile" || window.innerWidth < 760;
  document.body.className = S.theme === "dark" ? "dark" : "";
  const ctx = H.resolve();
  const C = H.concept;
  const overlay = S.pop || S.sheet;
  root.innerHTML = `${H.ui.review()}<div class="stage">
    <div class="frame ${H.compact ? "mobile" : ""}"><div class="app">
      ${H.compact ? "" : C.sidebar?.(ctx) || H.ui.sidebar()}
      <main class="main">${C.header?.(ctx) || H.ui.header(C.headerExtra?.(ctx) || "")}<div class="body">${C.render(ctx)}</div>${C.bottom?.(ctx) || ""}</main>
      ${overlay ? `<div class="scrim ${S.sheet || H.compact ? "dim" : ""}" data-a="close"></div>` : ""}
      ${S.pop ? `<div class="pop" role="menu">${H.ui.pop(ctx)}</div>` : ""}
      ${S.sheet ? H.ui.sheet(ctx) : ""}
      ${S.toast ? `<div class="toast" role="status">${H.esc(S.toast.text)}${S.toast.sessionId ? ` <button class="link" data-a="open-session" data-id="${S.toast.sessionId}">Open</button>` : ""}</div>` : ""}
    </div></div>
    ${S.notes ? `<aside class="notes">${C.notes}</aside>` : ""}
  </div>`;
  const body = root.querySelector(".body");
  if (body) body.scrollTop = scrollTop;
  if (S.pop && !H.compact) placePop();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (sel) el.setSelectionRange(...sel);
    }
  }
  autosize();
};
function placePop() {
  const frame = document.querySelector(".frame");
  const pop = document.querySelector(".pop");
  const anchor = frame.querySelector(`[data-anchor="${H.S.pop.anchor}"]`);
  if (!anchor || !pop) return;
  const f = frame.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const below = a.bottom - f.top + 6;
  const fitsBelow = below + pop.offsetHeight < f.height - 8;
  pop.style.top = `${fitsBelow ? below : Math.max(8, a.top - f.top - pop.offsetHeight - 6)}px`;
  pop.style.left = `${Math.min(Math.max(8, a.left - f.left), f.width - pop.offsetWidth - 8)}px`;
}
function autosize() {
  const t = document.getElementById("draft");
  if (!t) return;
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 220)}px`;
}

// ---------- Actions ----------
const A = H.actions;
const S_ = () => H.S;
Object.assign(A, {
  noop() {},
  close() {
    S_().pop = null;
    S_().sheet = null;
  },
  pop(el) {
    const S = S_();
    S.sheet = null;
    S.pop =
      S.pop?.kind === el.dataset.pop ? null : { kind: el.dataset.pop, anchor: el.dataset.anchor };
  },
  sheet(el) {
    const S = S_();
    S.pop = null;
    S.sheet = el.dataset.sheet;
    if (S.sheet === "pair")
      S.pair = { method: el.dataset.method || (H.compact ? "qr" : "link"), state: "idle" };
  },
  "pick-host"(el) {
    const S = S_();
    const h = H.host(el.dataset.id);
    const last = S.memory.byHost[h.id];
    S.pick = {
      hostId: h.id,
      projectId: H.project(last) ? last : H.projectsOn(h.id)[0]?.id || null,
    };
    if (S.target?.kind === "bot" || S.memory.last?.target?.kind === "bot")
      S.target = { kind: "agent", provider: H.readyProviders(h)[0] || "claude" };
    S.pop = null;
  },
  "pick-project"(el) {
    const S = S_();
    const p = H.project(el.dataset.id);
    S.pick = { hostId: p.hostId, projectId: p.id };
    const ctx = H.resolve();
    if (ctx.target.kind !== "agent")
      S.target = { kind: "agent", provider: H.readyProviders(H.host(p.hostId))[0] || "claude" };
    S.pop = null;
  },
  "pick-personal"() {
    const S = S_();
    const ctx = H.resolve();
    S.pick = { hostId: ctx.host.id, projectId: null };
    S.target = { kind: "starter" };
    S.pop = null;
  },
  "pick-provider"(el) {
    const S = S_();
    const ctx = H.resolve();
    if (ctx.reason === "bot")
      S.pick = { hostId: ctx.host.id, projectId: H.projectsOn(ctx.host.id)[0]?.id || null };
    S.target = { kind: "agent", provider: el.dataset.id };
    S.pop = null;
  },
  "pick-bot"(el) {
    const S = S_();
    S.target = { kind: "bot", botId: el.dataset.id };
    S.pop = null;
  },
  "target-agent"() {
    const S = S_();
    const h = S.hosts.find(H.online);
    S.target = { kind: "agent", provider: "claude" };
    if (h) S.pick = { hostId: h.id, projectId: H.projectsOn(h.id)[0]?.id || null };
  },
  set(el) {
    S_()[el.dataset.k] = el.dataset.v;
    S_().pop = null;
  },
  dismiss(el) {
    S_().dismissed[el.dataset.id] = true;
  },
  send() {
    H.send();
  },
  focus() {
    S_().pop = null;
    requestAnimationFrame(() => document.getElementById("draft")?.focus());
  },
  attach() {
    H.toast("Attach files (demo): files are uploaded to the chosen host");
  },
  mic() {
    H.toast("Dictation (demo)");
  },
  nav(el) {
    H.toast(`${el.dataset.id} — outside this Home prototype`);
  },
  "open-desktop"() {
    H.toast("Opening Clisbot Desktop… then press Look again");
  },
  download() {
    H.toast("clisbot.com/download");
  },
  copy() {
    H.toast("Copied");
  },
  probe() {
    H.probe(false);
  },
  reconnect(el) {
    H.reconnect(el.dataset.id);
    S_().pop = null;
  },
  "providers-check"() {
    const h = S_().hosts[0];
    h.providers.claude = "ready";
    H.toast("Claude Code is ready on this Mac");
  },
  "open-session"(el) {
    S_().pop = null;
    S_().sheet = `session:${el.dataset.id}`;
  },
  "open-schedule"(el) {
    S_().pop = null;
    S_().sheet = `schedule:${el.dataset.id}`;
  },
  "open-real"(el) {
    const s = S_().sessions.find((x) => x.id === el.dataset.id);
    S_().sheet = null;
    H.toast(`Opens “${s.title}” on its own host`);
  },
  approve(el) {
    const s = S_().sessions.find((x) => x.id === el.dataset.id);
    s.status = "running";
    s.preview = "Approved · running";
    s.ask = null;
    S_().sheet = null;
    H.toast(`Approved · ${s.title}`);
  },
  deny(el) {
    const s = S_().sessions.find((x) => x.id === el.dataset.id);
    s.status = "idle";
    s.preview = "Denied · waiting for you";
    S_().sheet = null;
  },
  retry(el) {
    const s = S_().sessions.find((x) => x.id === el.dataset.id);
    s.status = "running";
    s.preview = "Retrying…";
    H.toast(`Retrying ${s.title}`);
  },
  "toggle-pause"(el) {
    const k = S_().schedules.find((x) => x.id === el.dataset.id);
    k.paused = !k.paused;
  },
  "run-now"(el) {
    const k = S_().schedules.find((x) => x.id === el.dataset.id);
    S_().sheet = null;
    H.toast(`Running ${k.name} now`);
  },
  "pair-method"(el) {
    S_().pair = { method: el.dataset.id, state: "idle" };
  },
  "pair-expire"() {
    S_().pair.state = "error";
  },
  "pair-go"() {
    S_().pair.state = "busy";
    H.later(1200, () => H.pairDone());
  },
  "add-project"() {
    const S = S_();
    const h = H.resolve().host || S.hosts.find(H.online);
    const path = document.getElementById("newpath")?.value || "~/projects/website";
    const p = {
      id: `p${Date.now()}`,
      hostId: h.id,
      name: path.split("/").findLast(Boolean),
      path,
      usedAgo: 0,
    };
    S.projects.push(p);
    S.pick = { hostId: h.id, projectId: p.id };
    if (H.resolve().target.kind !== "agent")
      S.target = { kind: "agent", provider: H.readyProviders(h)[0] || "claude" };
    S.sheet = null;
    H.toast(`Added ${p.name}`);
  },
  filter(el) {
    S_().filter = el.dataset.id;
  },
  starter(el) {
    const S = S_();
    S.draft = S.draft.trim() ? `${S.draft.trim()}\n${el.dataset.text}` : el.dataset.text;
    requestAnimationFrame(() => {
      const t = document.getElementById("draft");
      t?.focus();
      t?.setSelectionRange(t.value.length, t.value.length);
    });
  },
  // Review chrome
  device(el) {
    const S = S_();
    if (H.concept.variants) {
      H.seedVariant(H.currentVariant() || H.concept.variants[0], el.dataset.id);
      H.saveUi();
      return;
    }
    const scenario = S.sc.device && S.sc.device !== el.dataset.id ? "returning" : S.scenario;
    H.seed(scenario, { device: el.dataset.id, theme: S.theme, notes: S.notes });
    H.saveUi();
  },
  theme() {
    S_().theme = S_().theme === "dark" ? "light" : "dark";
    H.saveUi();
  },
  notes() {
    S_().notes = !S_().notes;
    H.saveUi();
  },
  reset() {
    const S = S_();
    H.seed(S.scenario, { device: S.device, theme: S.theme, notes: S.notes });
  },
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const fn = H.actions[el.dataset.a];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  fn(el, e);
  H.render();
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.change === "scenario") {
    const sc = H.scenarios.find((s) => s.id === e.target.value);
    H.seed(sc.id, { device: sc.device || H.S.device, theme: H.S.theme, notes: H.S.notes });
    H.saveUi();
    H.render();
  }
  if (e.target.dataset.change === "variant") {
    H.seedVariant(
      H.concept.variants.find((v) => v.id === e.target.value),
      H.S.device,
    );
    H.saveUi();
    H.render();
  }
  if (e.target.dataset.change === "hub") {
    const S = H.S;
    H.seed(S.scenario, { device: S.device, theme: S.theme, notes: S.notes, hub: e.target.value });
    H.saveUi();
    H.render();
  }
});
document.addEventListener("input", (e) => {
  // Search fields bind to one state key and re-render; render() keeps focus and caret.
  if (e.target.dataset.model) {
    H.S[e.target.dataset.model] = e.target.value;
    H.render();
    return;
  }
  if (e.target.id !== "draft") return;
  H.S.draft = e.target.value;
  const send = document.getElementById("send");
  if (send) send.disabled = !H.resolve().canSend || !H.S.draft.trim();
  autosize();
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "draft" && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    H.send();
    H.render();
    return;
  }
  if (e.key === "Escape" && (H.S.pop || H.S.sheet)) {
    A.close();
    H.render();
    return;
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (!typing && e.key === "/") {
    e.preventDefault();
    document.getElementById("draft")?.focus();
  }
});
let resizeRaf;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(H.render);
});
window.addEventListener("DOMContentLoaded", () => {
  H.load();
  H.render();
});
