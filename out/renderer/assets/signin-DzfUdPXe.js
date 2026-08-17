const startupEl = document.getElementById("startup-loading");
const MAIN_APP = "./index.html";
function goToApp() {
  window.location.href = MAIN_APP;
}
function hideStartup() {
  if (startupEl && !startupEl.classList.contains("fade-out")) {
    startupEl.classList.add("fade-out");
  }
}
async function waitForElectron(timeout = 4e3) {
  const start = Date.now();
  while (!window.electron && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return !!window.electron;
}
const electronReady = await waitForElectron();
if (!electronReady) {
  hideStartup();
}
async function checkExistingUser() {
  try {
    const user = await window.electron?.getUser?.();
    if (user && (user.name || user.email)) {
      localStorage.setItem("cilamai-user", JSON.stringify(user));
      return true;
    }
  } catch {
  }
  return false;
}
if (electronReady && await checkExistingUser()) {
  hideStartup();
  goToApp();
} else {
  hideStartup();
  const signinPanel = document.getElementById("signin-panel");
  const waitingPanel = document.getElementById("waiting-panel");
  document.querySelector("#close-btn")?.addEventListener("click", () => {
    window.electron?.closeWindow?.() || window.close();
  });
  document.querySelector("#signup-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelector("#github-btn")?.click();
  });
  document.querySelector("#skip-btn")?.addEventListener("click", () => {
    goToApp();
  });
  document.querySelector("#google-btn")?.addEventListener("click", async () => {
    if (window.electron?.signIn) {
      signinPanel.style.display = "none";
      waitingPanel.classList.add("active");
      const result = await window.electron.signIn("google");
      if (result?.ok && result.user) {
        localStorage.setItem("cilamai-user", JSON.stringify(result.user));
        window.electron?.setUser?.(result.user);
        goToApp();
      } else {
        waitingPanel.classList.remove("active");
        signinPanel.style.display = "";
      }
    }
  });
  document.querySelector("#github-btn")?.addEventListener("click", async () => {
    if (window.electron?.signIn) {
      signinPanel.style.display = "none";
      waitingPanel.classList.add("active");
      const result = await window.electron.signIn("github");
      if (result?.ok && result.user) {
        localStorage.setItem("cilamai-user", JSON.stringify(result.user));
        window.electron?.setUser?.(result.user);
        goToApp();
      } else {
        waitingPanel.classList.remove("active");
        signinPanel.style.display = "";
      }
    }
  });
  document.querySelector("#cancel-signin-btn")?.addEventListener("click", () => {
    waitingPanel.classList.remove("active");
    signinPanel.style.display = "";
  });
}
