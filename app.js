// Local cache key for offline fallback.
const LOCAL_KEY = "studygram-planner-v1";

// Create a fresh default state object.
function makeDefaultState() {
	return {
		theme: "light",
		uploads: { timetable: [], notes: [] },
		flashcards: [],
		tasks: [],
		preferences: { label: "evening", start: "18:00", end: "21:00", dailyMinutes: 120 },
		sessions: [],
		reminders: []
	};
}

// Normalize a state-like object to required structure.
function normalizeState(raw) {
	const base = makeDefaultState();
	if (!raw || typeof raw !== "object") {
		return base;
	}
	return {
		theme: typeof raw.theme === "string" ? raw.theme : base.theme,
		uploads: {
			timetable: Array.isArray(raw.uploads?.timetable) ? raw.uploads.timetable : base.uploads.timetable,
			notes: Array.isArray(raw.uploads?.notes) ? raw.uploads.notes : base.uploads.notes
		},
		flashcards: Array.isArray(raw.flashcards) ? raw.flashcards : base.flashcards,
		tasks: Array.isArray(raw.tasks) ? raw.tasks : base.tasks,
		preferences: {
			label: typeof raw.preferences?.label === "string" ? raw.preferences.label : base.preferences.label,
			start: typeof raw.preferences?.start === "string" ? raw.preferences.start : base.preferences.start,
			end: typeof raw.preferences?.end === "string" ? raw.preferences.end : base.preferences.end,
			dailyMinutes: Number(raw.preferences?.dailyMinutes || base.preferences.dailyMinutes)
		},
		sessions: Array.isArray(raw.sessions) ? raw.sessions : base.sessions,
		reminders: Array.isArray(raw.reminders) ? raw.reminders : base.reminders
	};
}

// Load initial local state.
let state = normalizeState(JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"));

// Supabase references.
let supabaseClient = null;
let currentUser = null;
let cloudEnabled = false;
let hydratingFromCloud = false;

// Story state.
let cardIndex = 0;
let revealed = false;

// Escape HTML to render user text safely.
function esc(s) {
	return String(s)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

// Parse HH:MM to minutes from midnight.
function toMinutes(hhmm) {
	const [h, m] = hhmm.split(":").map(Number);
	return h * 60 + m;
}

// Persist state to local storage and cloud when logged in.
function saveState() {
	localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
	void pushStateToCloud();
}

// Push latest state to Supabase for current user.
async function pushStateToCloud() {
	if (!cloudEnabled || !currentUser || hydratingFromCloud) {
		return;
	}
	const { error } = await supabaseClient
		.from("planner_state")
		.upsert(
			{
				user_id: currentUser.id,
				state,
				updated_at: new Date().toISOString()
			},
			{ onConflict: "user_id" }
		);
	if (error) {
		showAuthMessage("Cloud sync warning: " + error.message, true);
	}
}

// Load user's cloud state from Supabase.
async function loadStateFromCloud() {
	if (!cloudEnabled || !currentUser) {
		return;
	}

	hydratingFromCloud = true;
	const { data, error } = await supabaseClient
		.from("planner_state")
		.select("state")
		.eq("user_id", currentUser.id)
		.maybeSingle();

	if (error) {
		hydratingFromCloud = false;
		showAuthMessage("Could not load cloud data: " + error.message, true);
		return;
	}

	if (data && data.state) {
		state = normalizeState(data.state);
		localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
	} else {
		await pushStateToCloud();
	}

	hydratingFromCloud = false;
	renderAll();
}

// Build simple flashcards from notes text.
function generateFlashcards(text) {
	const raw = text.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
	const useful = raw.filter(x => x.split(/\s+/).length >= 8).slice(0, 25);
	return useful.map((sentence, i) => {
		const parts = sentence.split(/\s+/);
		const q = "Complete: " + parts.slice(0, 3).join(" ") + " ...?";
		return { id: Date.now() + i, question: q, answer: sentence };
	});
}

// Build study sessions and reminders.
function generatePlan() {
	const prefs = state.preferences;
	const startMin = toMinutes(prefs.start);
	const endMin = toMinutes(prefs.end);
	const dayCap = Number(prefs.dailyMinutes) || 120;

	const tasks = [...state.tasks]
		.filter(t => t.status !== "done")
		.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

	const sessions = [];
	const reminders = [];
	const now = new Date();

	for (let d = 0; d < 7; d += 1) {
		const day = new Date(now);
		day.setDate(now.getDate() + d);
		day.setSeconds(0, 0);

		let used = 0;
		let cursor = startMin;

		while (cursor + 30 <= endMin && used < dayCap) {
			const task = tasks.find(t => t.remaining > 0);
			if (!task) {
				break;
			}

			const slotStart = new Date(day);
			slotStart.setHours(Math.floor(cursor / 60), cursor % 60, 0, 0);
			const slotEnd = new Date(slotStart);
			slotEnd.setMinutes(slotEnd.getMinutes() + 30);

			if (slotEnd < now) {
				cursor += 30;
				continue;
			}

			sessions.push({
				id: Date.now() + Math.floor(Math.random() * 100000),
				title: "Study: " + task.title,
				type: "task",
				startsAt: slotStart.toISOString(),
				endsAt: slotEnd.toISOString()
			});

			const remind = new Date(slotStart);
			remind.setMinutes(remind.getMinutes() - 15);
			if (remind > now) {
				reminders.push({
					id: Date.now() + Math.floor(Math.random() * 100000),
					message: "Upcoming study session: " + task.title,
					remindAt: remind.toISOString()
				});
			}

			task.remaining = Math.max(0, Number(task.remaining) - 30);
			used += 30;
			cursor += 30;
		}
	}

	state.sessions = sessions;
	state.reminders = reminders;
	saveState();
}

// Render feed lists.
function renderFeed() {
	const tWrap = document.getElementById("timetableList");
	const tasksWrap = document.getElementById("tasksList");
	const sWrap = document.getElementById("sessionsList");
	const rWrap = document.getElementById("remindersList");

	tWrap.innerHTML = state.uploads.timetable.length
		? state.uploads.timetable.map(x => `<div class="block"><strong>${esc(x.name)}</strong><div class="subtle">${esc(x.type)} | ${new Date(x.at).toLocaleString()}</div></div>`).join("")
		: `<p class="subtle">No timetable uploads yet.</p>`;

	tasksWrap.innerHTML = state.tasks.length
		? state.tasks.map(t => `<div class="block"><strong>${esc(t.title)}</strong><div>${esc(t.description)}</div><div class="subtle">Deadline: ${new Date(t.deadline).toLocaleString()}</div><div class="subtle">Remaining: ${t.remaining} min</div></div>`).join("")
		: `<p class="subtle">No tasks yet.</p>`;

	sWrap.innerHTML = state.sessions.length
		? state.sessions.map(s => `<div class="block"><strong>${esc(s.title)}</strong><div class="subtle">${new Date(s.startsAt).toLocaleString()} - ${new Date(s.endsAt).toLocaleTimeString()}</div></div>`).join("")
		: `<p class="subtle">No sessions yet. Press Generate Weekly Plan.</p>`;

	rWrap.innerHTML = state.reminders.length
		? state.reminders.map(r => `<div class="block"><strong>${esc(r.message)}</strong><div class="subtle">${new Date(r.remindAt).toLocaleString()}</div></div>`).join("")
		: `<p class="subtle">No reminders yet.</p>`;
}

// Render story card.
function renderStory() {
	const cards = state.flashcards;
	const q = document.getElementById("storyQuestion");
	const a = document.getElementById("storyAnswer");
	const dots = document.getElementById("storyDots");

	if (!cards.length) {
		q.textContent = "No flashcards yet";
		a.textContent = "Upload or paste notes from Feed first.";
		a.className = "subtle";
		dots.innerHTML = "";
		return;
	}

	cardIndex = Math.max(0, Math.min(cardIndex, cards.length - 1));
	const card = cards[cardIndex];
	q.textContent = card.question;
	a.textContent = revealed ? card.answer : "Tap Reveal to show answer.";
	a.className = revealed ? "" : "subtle";
	dots.innerHTML = cards.map((_, i) => `<span class="dot ${i === cardIndex ? "active" : ""}"></span>`).join("");
}

// Apply visual theme.
function applyTheme() {
	document.body.classList.toggle("dark", state.theme === "dark");
	document.getElementById("themeBtn").textContent = state.theme === "dark" ? "Light" : "Dark";
}

// Populate study preference controls.
function loadPreferencesForm() {
	document.getElementById("prefLabel").value = state.preferences.label;
	document.getElementById("prefStart").value = state.preferences.start;
	document.getElementById("prefEnd").value = state.preferences.end;
	document.getElementById("prefMinutes").value = state.preferences.dailyMinutes;
}

// Render all app sections.
function renderAll() {
	applyTheme();
	loadPreferencesForm();
	renderFeed();
	renderStory();
	updateAuthStatus();
}

// Print authentication status and mode.
function updateAuthStatus() {
	const authStatus = document.getElementById("authStatus");
	if (!cloudEnabled) {
		authStatus.textContent = "Cloud sync is off. Fill config.js to enable Supabase.";
		return;
	}
	if (currentUser) {
		authStatus.textContent = "Signed in as " + currentUser.email + ". Cloud sync is on.";
	} else {
		authStatus.textContent = "Cloud sync ready. Sign in to sync data across devices.";
	}
}

// Print auth result messages.
function showAuthMessage(message, isError = false) {
	const node = document.getElementById("authMsg");
	node.className = isError ? "subtle" : "ok";
	node.textContent = message;
}

// Configure Supabase if keys are present.
function setupSupabase() {
	const cfg = window.SUPABASE_CONFIG || {};
	const hasConfig = typeof cfg.url === "string" && cfg.url && typeof cfg.anonKey === "string" && cfg.anonKey;
	const hasLib = !!window.supabase;

	if (!hasConfig || !hasLib) {
		cloudEnabled = false;
		return;
	}

	supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
	cloudEnabled = true;

	supabaseClient.auth.onAuthStateChange((_event, session) => {
		currentUser = session?.user || null;
		updateAuthStatus();
		if (currentUser) {
			void loadStateFromCloud();
		}
	});
}

// Handle sign up action.
async function signUp() {
	if (!cloudEnabled) {
		showAuthMessage("Supabase not configured in config.js", true);
		return;
	}

	const email = document.getElementById("authEmail").value.trim();
	const password = document.getElementById("authPassword").value;

	if (!email || password.length < 6) {
		showAuthMessage("Enter a valid email and password (min 6 chars).", true);
		return;
	}

	const { error } = await supabaseClient.auth.signUp({ email, password });
	if (error) {
		showAuthMessage(error.message, true);
		return;
	}

	showAuthMessage("Sign-up successful. Check your email if confirmation is required.");
}

// Handle sign in action.
async function signIn() {
	if (!cloudEnabled) {
		showAuthMessage("Supabase not configured in config.js", true);
		return;
	}

	const email = document.getElementById("authEmail").value.trim();
	const password = document.getElementById("authPassword").value;

	if (!email || !password) {
		showAuthMessage("Enter email and password.", true);
		return;
	}

	const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
	if (error) {
		showAuthMessage(error.message, true);
		return;
	}

	showAuthMessage("Signed in. Syncing cloud data...");
}

// Handle sign out action.
async function signOut() {
	if (!cloudEnabled) {
		showAuthMessage("Supabase not configured in config.js", true);
		return;
	}

	const { error } = await supabaseClient.auth.signOut();
	if (error) {
		showAuthMessage(error.message, true);
		return;
	}

	currentUser = null;
	updateAuthStatus();
	showAuthMessage("Signed out. Working in local mode.");
}

// Bind navigation tabs.
function bindTabs() {
	document.querySelectorAll(".tab").forEach(tab => {
		tab.addEventListener("click", () => {
			document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
			tab.classList.add("active");

			const id = tab.getAttribute("data-view");
			document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
			document.getElementById(id).classList.add("active");
		});
	});
}

// Bind all click and input handlers.
function bindActions() {
	document.getElementById("themeBtn").addEventListener("click", () => {
		state.theme = state.theme === "dark" ? "light" : "dark";
		saveState();
		applyTheme();
	});

	document.getElementById("saveTimetableBtn").addEventListener("click", () => {
		const input = document.getElementById("timetableFile");
		const file = input.files && input.files[0];
		const msg = document.getElementById("uploadMsg");

		if (!file) {
			msg.textContent = "Choose a timetable file first.";
			return;
		}

		state.uploads.timetable.push({ name: file.name, type: file.type || "unknown", at: new Date().toISOString() });
		saveState();
		renderFeed();
		msg.textContent = "Timetable file saved.";
		input.value = "";
	});

	document.getElementById("saveNotesBtn").addEventListener("click", async () => {
		const fileInput = document.getElementById("notesFile");
		const textArea = document.getElementById("notesText");
		const file = fileInput.files && fileInput.files[0];
		const msg = document.getElementById("uploadMsg");

		let text = textArea.value.trim();

		if (!text && file) {
			try {
				text = await file.text();
			} catch (_error) {
				text = "";
			}
		}

		if (!text) {
			msg.textContent = "Add notes text or pick a text-like notes file.";
			return;
		}

		state.uploads.notes.push({ name: file ? file.name : "pasted-notes", type: file ? (file.type || "unknown") : "text/plain", at: new Date().toISOString() });
		state.flashcards = generateFlashcards(text);

		saveState();
		renderFeed();

		revealed = false;
		cardIndex = 0;
		renderStory();

		msg.textContent = "Generated " + state.flashcards.length + " flashcards.";
		fileInput.value = "";
		textArea.value = "";
	});

	document.getElementById("addTaskBtn").addEventListener("click", () => {
		const title = document.getElementById("taskTitle").value.trim();
		const description = document.getElementById("taskDescription").value.trim();
		const deadline = document.getElementById("taskDeadline").value;
		const minutes = Number(document.getElementById("taskMinutes").value || 120);

		if (!title || !description || !deadline) {
			return;
		}

		state.tasks.push({
			id: Date.now(),
			title,
			description,
			deadline: new Date(deadline).toISOString(),
			estimated: minutes,
			remaining: minutes,
			status: "pending"
		});

		saveState();
		renderFeed();

		document.getElementById("taskTitle").value = "";
		document.getElementById("taskDescription").value = "";
		document.getElementById("taskDeadline").value = "";
		document.getElementById("taskMinutes").value = "120";
	});

	document.getElementById("planBtn").addEventListener("click", () => {
		generatePlan();
		renderFeed();
	});

	document.getElementById("savePrefsBtn").addEventListener("click", () => {
		state.preferences = {
			label: document.getElementById("prefLabel").value,
			start: document.getElementById("prefStart").value,
			end: document.getElementById("prefEnd").value,
			dailyMinutes: Number(document.getElementById("prefMinutes").value || 120)
		};
		saveState();
		document.getElementById("prefsMsg").textContent = "Preferences saved.";
	});

	document.getElementById("prevCardBtn").addEventListener("click", () => {
		cardIndex = Math.max(0, cardIndex - 1);
		revealed = false;
		renderStory();
	});

	document.getElementById("nextCardBtn").addEventListener("click", () => {
		cardIndex = Math.min(Math.max(0, state.flashcards.length - 1), cardIndex + 1);
		revealed = false;
		renderStory();
	});

	document.getElementById("revealBtn").addEventListener("click", () => {
		revealed = !revealed;
		renderStory();
	});

	document.getElementById("storyCard").addEventListener("wheel", event => {
		if (event.deltaY > 0) {
			cardIndex = Math.min(Math.max(0, state.flashcards.length - 1), cardIndex + 1);
		} else {
			cardIndex = Math.max(0, cardIndex - 1);
		}
		revealed = false;
		renderStory();
	});

	document.getElementById("signUpBtn").addEventListener("click", () => {
		void signUp();
	});

	document.getElementById("signInBtn").addEventListener("click", () => {
		void signIn();
	});

	document.getElementById("signOutBtn").addEventListener("click", () => {
		void signOut();
	});
}

// Boot sequence.
async function init() {
	bindTabs();
	bindActions();
	setupSupabase();
	renderAll();

	if (!cloudEnabled) {
		return;
	}

	const { data, error } = await supabaseClient.auth.getSession();
	if (error) {
		showAuthMessage("Session check failed: " + error.message, true);
		return;
	}

	currentUser = data?.session?.user || null;
	updateAuthStatus();

	if (currentUser) {
		await loadStateFromCloud();
		showAuthMessage("Cloud data loaded for " + currentUser.email + ".");
	}
}

void init();