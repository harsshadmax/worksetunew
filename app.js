// app.js — Worksetu (new frontend), Vue 3 Composition API.
// Talks to the exact same backend as the original site — same routes,
// same request/response contract, same auth model. No backend changes.
//
// Deliberate performance choices for this rewrite (the brief asked for
// "lightweight rendering, optimized asset loading" to address reported lag
// for users far from the server region):
//   - Vue's PRODUCTION build (vue.global.prod.js), not the dev build the
//     original site loads — smaller, no dev-mode warnings/checks per render.
//   - No Tailwind Play CDN (in-browser JIT compilation on every load) —
//     styles.css is plain, precompiled-by-nobody-but-the-browser CSS.
//   - No count-up/IntersectionObserver animations. Numbers just render.
//     (The original site's equivalent code leaked an IntersectionObserver
//     per mount, which is exactly the kind of bug this rewrite avoids by
//     not having the feature in v1 at all — see DEPLOY.md.)
//   - Login: profile + catalog fetches run in parallel (Promise.all), not
//     one-after-another, and the catalog is only re-fetched if it isn't
//     already loaded.
//   - Logout: local session state clears synchronously and instantly;
//     the server-side logout call fires in the background, unawaited.
//   - No Socket.io / persistent WebSocket. Status updates are pull-based
//     (an explicit Refresh action), trading real-time push for a much
//     smaller JS payload and one less always-open connection. See
//     DEPLOY.md for how to add it back without any backend change.
const { createApp, ref, reactive, computed, onMounted } = Vue;

const DEMO_ACCOUNTS = {
  customer: { label: "Deepika Ramaswamy", tag: "CUSTOMER", identifier: "deepika@example.com", password: "TestPass@123" },
  worker: { label: "Ravi Kumar (Plumber, Chennai Coop)", tag: "WORKER", identifier: "ravi.kumar@example.com", password: "Worker@123" },
  admin: { label: "Registrar (Super Admin)", tag: "ADMIN", identifier: "registrar@worksetu.coop", password: "AdminPass@123" }
};

createApp({
  setup() {
    const api = window.ApiClient;

    // ---------------------------------------------------------------
    // Navigation state
    // ---------------------------------------------------------------
    const role = ref(null); // 'customer' | 'worker' | 'admin' | null
    const view = ref("landing"); // 'landing' | 'login' | 'register' | 'dashboard'
    const authMode = ref("login"); // 'login' | 'register', within the login view

    function goLanding() {
      role.value = null;
      view.value = "landing";
    }
    function goAuth(chosenRole) {
      role.value = chosenRole;
      view.value = "login";
      authMode.value = "login";
      authError.value = "";
    }

    // ---------------------------------------------------------------
    // Catalog (public, unauthenticated data)
    // ---------------------------------------------------------------
    const platformStats = ref({ totalWorkers: 0, completedBookings: 0, activeCooperatives: 0 });
    const services = ref([]);
    const cooperatives = ref([]);

    async function loadCatalog() {
      const [stats, svc, coop] = await Promise.all([
        api.request("GET", "/public/stats").catch(() => platformStats.value),
        api.request("GET", "/services").catch(() => []),
        api.request("GET", "/public/cooperatives").catch(() => [])
      ]);
      platformStats.value = stats;
      services.value = svc;
      cooperatives.value = coop;
    }

    // ---------------------------------------------------------------
    // Auth
    // ---------------------------------------------------------------
    const user = ref(null); // GET /users/me response, or null
    const authForm = reactive({
      identifier: "",
      password: "",
      fullName: "",
      phone: "",
      address: "",
      cooperativeId: "",
      primarySkillId: "",
      experienceYears: 5,
      serviceAreaRadiusKm: 10
    });
    const authBusy = ref(false);
    const authError = ref("");

    function resetAuthForm() {
      authForm.identifier = "";
      authForm.password = "";
      authForm.fullName = "";
      authForm.phone = "";
      authForm.address = "";
      authForm.cooperativeId = "";
      authForm.primarySkillId = "";
    }

    function fillDemoAccount() {
      const demo = DEMO_ACCOUNTS[role.value];
      if (!demo) return;
      authForm.identifier = demo.identifier;
      authForm.password = demo.password;
    }

    // A rough, disclosed approximation for the register form's location —
    // this prototype has no map picker; the same approach the original
    // site uses (browser geolocation, falling back to a fixed point).
    function getCoordinates() {
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ lat: 13.0827, lng: 80.2707 });
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve({ lat: 13.0827, lng: 80.2707 }),
          { timeout: 4000 }
        );
      });
    }

    async function afterAuthSuccess(token, roleFromServer) {
      api.setAccessToken(token);
      // Independent requests — no reason to serialize them.
      const [profile] = await Promise.all([
        api.request("GET", "/users/me"),
        services.value.length === 0 ? loadCatalog() : Promise.resolve()
      ]);
      user.value = profile;
      view.value = "dashboard";
      resetAuthForm();
      if (role.value === "worker") await refreshWorkerData();
      if (role.value === "customer") await refreshCustomerData();
      if (role.value === "admin") await refreshAdminData();
    }

    async function handleLogin() {
      authError.value = "";
      authBusy.value = true;
      try {
        const res = await api.request("POST", `/auth/${role.value}/login`, {
          body: { identifier: authForm.identifier.trim(), password: authForm.password }
        });
        await afterAuthSuccess(res.token, res.role);
      } catch (err) {
        authError.value = err.message || "Login failed";
      } finally {
        authBusy.value = false;
      }
    }

    async function handleRegister() {
      authError.value = "";
      authBusy.value = true;
      try {
        const { lat, lng } = await getCoordinates();
        let res;
        if (role.value === "customer") {
          res = await api.request("POST", "/auth/customer/register", {
            body: {
              fullName: authForm.fullName,
              email: authForm.identifier.trim(),
              phone: authForm.phone.trim(),
              password: authForm.password,
              address: authForm.address,
              lat,
              lng,
              acceptedTerms: true
            }
          });
        } else if (role.value === "worker") {
          res = await api.request("POST", "/auth/worker/register", {
            body: {
              fullName: authForm.fullName,
              email: authForm.identifier.trim(),
              phone: authForm.phone.trim(),
              password: authForm.password,
              cooperativeId: authForm.cooperativeId,
              primarySkillId: authForm.primarySkillId,
              experienceYears: Number(authForm.experienceYears) || 0,
              homeLocation: { lat, lng, address: authForm.address },
              serviceAreaRadiusKm: Number(authForm.serviceAreaRadiusKm) || 5,
              acceptedTerms: true
            }
          });
        }
        await afterAuthSuccess(res.token, res.role);
      } catch (err) {
        authError.value = err.message || "Registration failed";
      } finally {
        authBusy.value = false;
      }
    }

    function handleLogout() {
      // Instant local reset; the server call is best-effort housekeeping
      // (revoking the refresh token) that the user should never have to
      // wait on. See the header comment for why this order matters.
      api.clearAccessToken();
      user.value = null;
      view.value = "landing";
      authMode.value = "login";
      const priorRole = role.value;
      role.value = null;
      myBookings.value = [];
      activeBookingId.value = null;
      workerIncoming.value = [];
      wallet.value = null;
      adminSummary.value = null;
      if (priorRole) api.request("POST", "/auth/logout").catch(() => {});
    }

    // ---------------------------------------------------------------
    // Customer
    // ---------------------------------------------------------------
    const selectedService = ref(null);
    const bookingForm = reactive({ address: "", description: "", urgency: "NORMAL" });
    const bookingBusy = ref(false);
    const bookingError = ref("");
    const myBookings = ref([]);
    const activeBookingId = ref(null);

    function selectService(svc) {
      selectedService.value = svc;
      bookingForm.address = user.value?.customerProfile?.defaultAddress || "";
      bookingForm.description = "";
      bookingForm.urgency = "NORMAL";
      bookingError.value = "";
    }

    async function submitBooking() {
      if (!selectedService.value) return;
      bookingBusy.value = true;
      bookingError.value = "";
      try {
        const { lat, lng } = await getCoordinates();
        const res = await api.request("POST", "/bookings/request", {
          body: {
            serviceCategoryId: selectedService.value.id,
            location: { address: bookingForm.address, lat, lng },
            description: bookingForm.description,
            scheduledAt: null,
            urgency: bookingForm.urgency
          }
        });
        activeBookingId.value = res.bookingId;
        selectedService.value = null;
        await refreshCustomerData();
      } catch (err) {
        bookingError.value = err.message || "Could not submit the request";
      } finally {
        bookingBusy.value = false;
      }
    }

    async function refreshCustomerData() {
      // listMyBookings returns the shared paginated envelope
      // ({ items, page, pageSize, totalCount, totalPages }), not a bare
      // array — the same contract every other paginated list route uses.
      const res = await api.request("GET", "/customers/me/bookings").catch(() => null);
      myBookings.value = res?.items || [];
    }

    // ---------------------------------------------------------------
    // Worker
    // ---------------------------------------------------------------
    const workerIncoming = ref([]);
    const wallet = ref(null);
    const availabilityBusy = ref(false);

    async function refreshWorkerData() {
      const [incoming, walletData] = await Promise.all([
        api.request("GET", "/workers/me/incoming").catch(() => []),
        api.request("GET", "/workers/me/wallet").catch(() => null)
      ]);
      workerIncoming.value = incoming;
      wallet.value = walletData;
    }

    async function toggleAvailability() {
      if (!user.value?.workerProfile) return;
      availabilityBusy.value = true;
      const next = user.value.workerProfile.availabilityStatus === "AVAILABLE" ? "OFF_DUTY" : "AVAILABLE";
      try {
        await api.request("PATCH", "/workers/me/availability", { body: { status: next } });
        user.value.workerProfile.availabilityStatus = next;
        if (next === "AVAILABLE") {
          const { lat, lng } = await getCoordinates();
          await api.request("POST", "/workers/location-ping", { body: { lat, lng } }).catch(() => {});
        }
      } catch (err) {
        bookingError.value = err.message || "Could not update availability";
      } finally {
        availabilityBusy.value = false;
      }
    }

    async function respondToOffer(offer, response) {
      await api
        .request("POST", `/dispatch/${offer.dispatchLogId}/respond`, { body: { response } })
        .catch(() => {});
      await refreshWorkerData();
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------
    const adminSummary = ref(null);

    async function refreshAdminData() {
      adminSummary.value = await api.request("GET", "/admin/dashboard/summary").catch(() => null);
    }

    // ---------------------------------------------------------------
    // Session restore on page load (refresh-cookie silent rotate)
    // ---------------------------------------------------------------
    const bootChecked = ref(false);

    onMounted(async () => {
      await loadCatalog();
      try {
        const token = await api.refreshSession();
        api.setAccessToken(token);
        const profile = await api.request("GET", "/users/me");
        user.value = profile;
        role.value = profile.role.toLowerCase();
        view.value = "dashboard";
        if (role.value === "worker") await refreshWorkerData();
        if (role.value === "customer") await refreshCustomerData();
        if (role.value === "admin") await refreshAdminData();
      } catch {
        // No valid session — stay on the landing page. Expected for most
        // first visits; not an error worth surfacing to the user.
      } finally {
        bootChecked.value = true;
      }

      api.onExpired(() => {
        user.value = null;
        role.value = null;
        view.value = "landing";
      });
    });

    function formatCurrency(n) {
      return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
    }

    return {
      role,
      view,
      authMode,
      goLanding,
      goAuth,
      platformStats,
      services,
      cooperatives,
      user,
      authForm,
      authBusy,
      authError,
      handleLogin,
      handleRegister,
      handleLogout,
      fillDemoAccount,
      demoAccount: computed(() => DEMO_ACCOUNTS[role.value]),
      bootChecked,
      selectedService,
      bookingForm,
      bookingBusy,
      bookingError,
      selectService,
      submitBooking,
      myBookings,
      workerIncoming,
      wallet,
      availabilityBusy,
      toggleAvailability,
      respondToOffer,
      refreshWorkerData,
      refreshCustomerData,
      adminSummary,
      refreshAdminData,
      formatCurrency
    };
  }
}).mount("#app");
