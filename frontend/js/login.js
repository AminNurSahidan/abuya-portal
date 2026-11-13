const API_BASE = "/api";
const TOKEN_KEY = "abuya_token";
const REMEMBER_EMAIL_KEY = "abuya_remember_email";
const REDIRECT_AFTER_LOGIN = "dashboard.html";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const pwdInput = document.getElementById("password");
const togglePwd = document.getElementById("togglePwd");
const pwdIcon = document.getElementById("pwdIcon");
const rememberInput = document.getElementById("remember");
const submitBtn = document.getElementById("submitBtn");
const submitText = document.getElementById("submitText");
const submitIcon = submitBtn.querySelector(".material-symbols-outlined");
const feedback = document.getElementById("feedback");
const forgotLink = document.getElementById("forgotLink");

document.getElementById("year").textContent = new Date().getFullYear();

const savedEmail = storageGet(localStorage, REMEMBER_EMAIL_KEY);
if (savedEmail) emailInput.value = savedEmail;

checkSession();

togglePwd.addEventListener("click", () => {
  const show = pwdInput.type === "password";
  pwdInput.type = show ? "text" : "password";
  pwdIcon.textContent = show ? "visibility_off" : "visibility";
});

[emailInput, pwdInput].forEach((el) => {
  el.addEventListener("input", () => {
    el.closest(".input-wrap").classList.remove("invalid");
    hideFeedback();
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = pwdInput.value;
  const remember = rememberInput.checked;

  if (!validate(email, password)) return;

  setLoading(true);
  showFeedback("info", "Memverifikasi akun...");

  try {
    const res = await fetch(API_BASE + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setLoading(false);
      showFeedback("error", errorMessage(res.status, data));
      if (res.status === 401) markInvalid(pwdInput);
      return;
    }

    saveToken(data.access_token, remember);
    if (remember) storageSet(localStorage, REMEMBER_EMAIL_KEY, email);
    else storageRemove(localStorage, REMEMBER_EMAIL_KEY);

    showFeedback("success", "Login berhasil. Memuat dashboard...");
    setTimeout(() => { window.location.href = REDIRECT_AFTER_LOGIN; }, 600);
  } catch (err) {
    setLoading(false);
    showFeedback("error", "Gagal terhubung ke server. Cek koneksi internet.");
  }
});

forgotLink.addEventListener("click", (e) => {
  e.preventDefault();
  showFeedback("info", "Reset kata sandi dilakukan oleh admin. Hubungi Admin Operasional.");
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
  if (status === 422) return "Email atau kata sandi belum diisi dengan benar.";
  if (status >= 500) return "Server sedang bermasalah. Coba lagi beberapa saat.";
  return "Terjadi kesalahan. Coba lagi.";
}

function validate(email, password) {
  let ok = true;
  if (!isEmail(email)) {
    markInvalid(emailInput);
    ok = false;
  }
  if (!password) {
    markInvalid(pwdInput);
    ok = false;
  }
  if (!ok) showFeedback("error", "Email atau kata sandi belum diisi dengan benar.");
  return ok;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
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
