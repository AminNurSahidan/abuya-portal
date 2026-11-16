const API_BASE = "/api";
const TOKEN_KEY = "abuya_token";
const REMEMBER_USER_KEY = "abuya_remember_user";
const LOGOUT_REASON_KEY = "abuya_logout_reason";
const REDIRECT_AFTER_LOGIN = "dashboard.html";

const form = document.getElementById("loginForm");
const userInput = document.getElementById("username");
const pwdInput = document.getElementById("password");
const togglePwd = document.getElementById("togglePwd");
const pwdIcon = document.getElementById("pwdIcon");
const rememberInput = document.getElementById("remember");
const submitBtn = document.getElementById("submitBtn");
const submitText = document.getElementById("submitText");
const submitIcon = submitBtn.querySelector(".material-symbols-outlined");
const feedback = document.getElementById("feedback");
const forgotLink = document.getElementById("forgotLink");
const sessionNotice = document.getElementById("sessionNotice");

document.getElementById("year").textContent = new Date().getFullYear();

const savedUser = storageGet(localStorage, REMEMBER_USER_KEY);
if (savedUser) userInput.value = savedUser;

const reason = storageGet(sessionStorage, LOGOUT_REASON_KEY);
if (reason) {
  storageRemove(sessionStorage, LOGOUT_REASON_KEY);
  sessionNotice.textContent = reason;
  sessionNotice.hidden = false;
}

checkSession();

togglePwd.addEventListener("click", () => {
  const show = pwdInput.type === "password";
  pwdInput.type = show ? "text" : "password";
  pwdIcon.textContent = show ? "visibility_off" : "visibility";
});

[userInput, pwdInput].forEach((el) => {
  el.addEventListener("input", () => {
    el.closest(".input-wrap").classList.remove("invalid");
    hideFeedback();
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let username = userInput.value.trim();
  if (username.includes("@")) username = username.split("@")[0];
  const password = pwdInput.value;
  const remember = rememberInput.checked;

  if (!validate(username, password)) return;

  setLoading(true);
  showFeedback("info", "Memverifikasi akun...");

  try {
    const res = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, remember })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoading(false);
      showFeedback("error", errorMessage(res.status, data));
      if (res.status === 401) markInvalid(pwdInput);
      return;
    }

    saveToken(data.access_token, remember);
    if (remember) storageSet(localStorage, REMEMBER_USER_KEY, username);
    else storageRemove(localStorage, REMEMBER_USER_KEY);
    sessionNotice.hidden = true;

    showFeedback("success", "Login berhasil. Memuat dashboard...");
    setTimeout(() => { window.location.href = REDIRECT_AFTER_LOGIN; }, 500);
  } catch (err) {
    setLoading(false);
    showFeedback("error", "Gagal terhubung ke server. Cek koneksi internet.");
  }
});

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  showFeedback("info", "Reset password dilakukan oleh Master. Hubungi Master Layer ya.");
});

async function checkSession() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(API_BASE + "/auth/me", { headers: { Authorization: "Bearer " + token } });
    if (res.ok) window.location.replace(REDIRECT_AFTER_LOGIN);
    else if (res.status === 401) clearToken();
  } catch (err) {}
}

function errorMessage(status, data) {
  const detail = data && data.detail;
  if (typeof detail === "string") return detail;
  if (status === 422) return "Username atau password belum diisi dengan benar.";
  if (status >= 500) return "Server sedang bermasalah. Coba lagi beberapa saat.";
  return "Terjadi kesalahan. Coba lagi.";
}

function validate(username, password) {
  let ok = true;
  let msg = "Username atau password belum diisi.";
  if (!username) {
    markInvalid(userInput);
    ok = false;
  } else if (/[A-Z]/.test(username)) {
    markInvalid(userInput);
    msg = "Username harus huruf kecil semua.";
    ok = false;
  }
  if (!password) {
    markInvalid(pwdInput);
    ok = false;
  }
  if (!ok) showFeedback("error", msg);
  return ok;
}

function markInvalid(el) {
  el.closest(".input-wrap").classList.add("invalid");
}

function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitText.textContent = on ? "Memproses..." : "Masuk Sekarang";
  submitIcon.textContent = on ? "progress_activity" : "arrow_forward";
}

function showFeedback(type, msg) {
  feedback.className = "feedback show " + type;
  feedback.innerHTML = "";
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.textContent = msg;
  feedback.append(dot, text);
}

function hideFeedback() {
  feedback.className = "feedback";
  feedback.innerHTML = "";
}

function getToken() {
  return storageGet(localStorage, TOKEN_KEY) || storageGet(sessionStorage, TOKEN_KEY);
}

function saveToken(token, remember) {
  clearToken();
  storageSet(remember ? localStorage : sessionStorage, TOKEN_KEY, token);
}

function clearToken() {
  storageRemove(localStorage, TOKEN_KEY);
  storageRemove(sessionStorage, TOKEN_KEY);
}

function storageGet(store, k) {
  try { return store.getItem(k); } catch (e) { return null; }
}

function storageSet(store, k, v) {
  try { store.setItem(k, v); } catch (e) {}
}

function storageRemove(store, k) {
  try { store.removeItem(k); } catch (e) {}
}