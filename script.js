const STORAGE = {
  users: "eduShareUsers",
  materials: "eduShareMaterials",
  user: "eduShareCurrentUser",
  downloads: "eduShareDownloads",
  favorites: "eduShareFavorites"
};

function readStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (error) {
    console.error(`Could not read ${key} from browser storage.`, error);
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save ${key} to browser storage.`, error);
    return false;
  }
}

function getUsers() { return readStorage(STORAGE.users, []); }
function getNotes() { return readStorage(STORAGE.materials, []); }
function currentUser() { return localStorage.getItem(STORAGE.user); }
function currentStudent() { return getUsers().find(user => user.email === currentUser()); }
function getFavoriteIds(email = currentUser()) {
  const favorites = readStorage(STORAGE.favorites, {});
  return Array.isArray(favorites[email]) ? favorites[email] : [];
}

function getCollegeOptions() {
  const colleges = [...getUsers(), ...getNotes()]
    .map(item => String(item.college || "").trim())
    .filter(Boolean);
  return [...new Map(colleges.map(college => [college.toLocaleLowerCase(), college])).values()]
    .sort((first, second) => first.localeCompare(second));
}

function updateCollegePicker(selectId, customId, selectedCollege = "") {
  const select = document.getElementById(selectId);
  const customField = document.getElementById(customId);
  const customInput = customField.querySelector("input");
  const colleges = getCollegeOptions();
  select.replaceChildren(new Option("Select a college", ""));
  colleges.forEach(college => select.add(new Option(college, college)));
  select.add(new Option("Add a new college", "__add_college__"));

  const match = colleges.find(college => college.toLocaleLowerCase() === selectedCollege.toLocaleLowerCase());
  if (selectedCollege && !match) {
    select.value = "__add_college__";
    customInput.value = selectedCollege;
  } else {
    select.value = match || "";
    customInput.value = "";
  }
  syncCollegePicker(select, customField, customInput);
  select.addEventListener("change", () => syncCollegePicker(select, customField, customInput));
}

function syncCollegePicker(select, customField, customInput) {
  const addingCollege = select.value === "__add_college__";
  customField.classList.toggle("hidden", !addingCollege);
  customInput.required = addingCollege;
  if (!addingCollege) customInput.value = "";
}

function selectedCollege(selectId, customId) {
  const select = document.getElementById(selectId);
  if (select.value === "__add_college__") {
    return document.getElementById(customId).querySelector("input").value.trim();
  }
  return select.value.trim();
}

function updateSubjectPicker() {
  const options = document.getElementById("subject-options");
  if (!options) return;
  const subjects = [...new Set(getNotes()
    .map(item => String(item.subject || "").trim())
    .filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  options.replaceChildren(...subjects.map(subject => {
    const option = document.createElement("option");
    option.value = subject;
    return option;
  }));
}

function selectedSubject() {
  return document.getElementById("subject-search").value.trim();
}

function initializeLocationControls() {
  document.querySelectorAll("[data-location-target]").forEach(button => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.locationTarget);
      const message = document.getElementById(`${input.id}-message`);
      if (!navigator.geolocation) {
        setMessage(message, "Location is unavailable in this browser. You can enter it manually.", true);
        return;
      }
      button.disabled = true;
      setMessage(message, "Requesting your current location permission...");
      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude, accuracy } = position.coords;
          input.value = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} (within ${Math.round(accuracy)} m)`;
          setMessage(message, "Location added. It is saved with your browser profile or upload.");
          button.disabled = false;
        },
        error => {
          const reason = error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser settings or enter a location manually."
            : error.code === error.POSITION_UNAVAILABLE
              ? "Your location is currently unavailable. Try again or enter it manually."
              : "Location lookup timed out. Try again or enter it manually.";
          setMessage(message, reason, true);
          button.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  });
}

let faceDetector = null;
let faceCameraStream = null;
let faceDetectionFrame = 0;
let faceCheckPassed = false;

async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, key, 256);
  return {
    salt: btoa(String.fromCharCode(...salt)),
    hash: btoa(String.fromCharCode(...new Uint8Array(bits)))
  };
}

function decodeSalt(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

function setMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function requireLogin() {
  const protectedPage = document.body.dataset.protected === "true";
  if (protectedPage && !currentStudent()) {
    sessionStorage.setItem("eduShareRedirect", location.pathname.split(/[\\/]/).pop());
    location.replace("login.html?required=1");
    return false;
  }
  return true;
}

async function register(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const student = {
    name: String(data.get("name")).trim(),
    college: selectedCollege("college-select", "college-custom-field"),
    location: String(data.get("location") || "").trim(),
    roll: String(data.get("roll")).trim(),
    department: String(data.get("department")).trim(),
    year: String(data.get("year")),
    semester: String(data.get("semester")),
    phone: String(data.get("phone")).trim(),
    email: String(data.get("email")).trim().toLowerCase(),
    password: String(data.get("password"))
  };
  const message = document.getElementById("register-message");
  const users = getUsers();
  if (users.some(user =>
    user.email === student.email ||
    String(user.roll || "").toLowerCase() === student.roll.toLowerCase() ||
    String(user.phone || "") === student.phone
  )) {
    setMessage(message, "That email, phone number, or roll number is already registered. Please log in instead.", true);
    return;
  }
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const credentials = await hashPassword(student.password);
    delete student.password;
    student.passwordSalt = credentials.salt;
    student.passwordHash = credentials.hash;
  } catch (error) {
    console.error("Could not protect the new account password.", error);
    setMessage(message, "Secure password storage is unavailable in this browser. Open the site in a modern browser and try again.", true);
    submitButton.disabled = false;
    return;
  }
  if (!writeStorage(STORAGE.users, [...users, student])) {
    setMessage(message, "Your account could not be saved in this browser. Check available storage and try again.", true);
    submitButton.disabled = false;
    return;
  }
  setMessage(message, "Account created. You can now log in with your email, phone number, or roll number.");
  form.reset();
  window.setTimeout(() => { location.href = "login.html"; }, 700);
}

async function login(event) {
  event.preventDefault();
  const message = document.getElementById("login-message");
  if (!faceCheckPassed) {
    setMessage(message, "Scan your face with the front camera before logging in.", true);
    return;
  }
  const identifier = document.getElementById("identifier").value.trim().toLowerCase();
  const password = document.getElementById("password").value;
  const student = getUsers().find(user =>
    [user.email, user.phone, user.roll].some(value => String(value || "").toLowerCase() === identifier)
  );
  if (!student || !student.passwordSalt || !student.passwordHash) {
    setMessage(message, "We couldn't find an account with those details. Check your login or register first.", true);
    return;
  }
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  try {
    const credentials = await hashPassword(password, decodeSalt(student.passwordSalt));
    if (credentials.hash !== student.passwordHash) {
      setMessage(message, "We couldn't find an account with those details. Check your login or register first.", true);
      submitButton.disabled = false;
      return;
    }
  } catch (error) {
    console.error("Could not verify the student password.", error);
    setMessage(message, "Secure login is unavailable in this browser. Please try a modern browser.", true);
    submitButton.disabled = false;
    return;
  }
  localStorage.setItem(STORAGE.user, student.email);
  const redirect = sessionStorage.getItem("eduShareRedirect");
  sessionStorage.removeItem("eduShareRedirect");
  location.href = redirect && !redirect.includes("/") && !redirect.includes("\\") ? redirect : "dashboard.html";
}

function stopFaceCheck() {
  if (faceDetectionFrame) cancelAnimationFrame(faceDetectionFrame);
  faceDetectionFrame = 0;
  if (faceCameraStream) faceCameraStream.getTracks().forEach(track => track.stop());
  faceCameraStream = null;
  const video = document.getElementById("face-video");
  if (video) video.srcObject = null;
  if (faceDetector) faceDetector.close();
  faceDetector = null;
}

async function startFaceCheck() {
  const startButton = document.getElementById("start-face-check");
  const message = document.getElementById("face-message");
  const video = document.getElementById("face-video");
  startButton.disabled = true;
  setMessage(message, "Requesting camera access and loading face detection...");
  if (!navigator.mediaDevices?.getUserMedia) {
    setMessage(message, "Camera access is unavailable. Open this site using HTTPS or localhost in a supported browser.", true);
    startButton.disabled = false;
    return;
  }
  try {
    faceCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    video.srcObject = faceCameraStream;
    await video.play();

    const { FaceDetector, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/vision_bundle.mjs");
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm");
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "CPU"
      },
      runningMode: "VIDEO"
    });
    setMessage(message, "Look at the camera. The check will continue when a face is visible.");
    detectFaceInVideo();
  } catch (error) {
    console.error("Could not start the camera face check.", error);
    stopFaceCheck();
    setMessage(message, "Face detection could not start. Allow camera access, check your connection, and try again.", true);
    startButton.disabled = false;
  }
}

function detectFaceInVideo() {
  const video = document.getElementById("face-video");
  const message = document.getElementById("face-message");
  if (!faceDetector || !video || faceCheckPassed) return;
  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const result = faceDetector.detectForVideo(video, performance.now());
      if (result.detections.length > 0) {
        faceCheckPassed = true;
        stopFaceCheck();
        document.getElementById("start-face-check").textContent = "Face scan complete";
        document.getElementById("login-submit").disabled = false;
        setMessage(message, "Face detected. This does not verify identity. Enter your login details and select Log in.");
        return;
      }
    }
    faceDetectionFrame = requestAnimationFrame(detectFaceInVideo);
  } catch (error) {
    console.error("Face detection failed.", error);
    stopFaceCheck();
    setMessage(message, "Face detection stopped unexpectedly. Please start the camera check again.", true);
    document.getElementById("start-face-check").disabled = false;
  }
}

function logout() {
  localStorage.removeItem(STORAGE.user);
  location.href = "index.html";
}

function saveMaterial(event) {
  event.preventDefault();
  const student = currentStudent();
  if (!student) {
    location.href = "login.html";
    return;
  }
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = data.get("file");
  const message = document.getElementById("upload-message");
  if (!(file instanceof File) || file.size === 0) {
    setMessage(message, "Choose a PDF file to upload.", true);
    return;
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setMessage(message, "Only PDF files can be uploaded.", true);
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    setMessage(message, "This demo supports PDF files up to 2 MB.", true);
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => setMessage(message, "The PDF could not be read. Please try again.", true);
  reader.onload = () => {
    const material = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: String(data.get("title")).trim(),
      subject: selectedSubject(),
      college: selectedCollege("college-select", "college-custom-field"),
      department: String(data.get("department")).trim(),
      semester: String(data.get("semester")).trim(),
      location: String(data.get("location") || "").trim(),
      filename: file.name,
      data: reader.result,
      owner: student.email,
      uploader: student.name,
      createdAt: new Date().toISOString()
    };
    const saved = writeStorage(STORAGE.materials, [...getNotes(), material]);
    if (!saved) {
      setMessage(message, "The PDF could not be saved. Browser storage may be full; try a smaller file.", true);
      return;
    }
    setMessage(message, "PDF uploaded and saved in this browser. Find it in Explore Materials here.");
    form.reset();
    updateCollegePicker("college-select", "college-custom-field", student.college || "");
    updateSubjectPicker();
    loadDashboard();
  };
  reader.readAsDataURL(file);
}

function addDetail(parent, label, value) {
  const item = document.createElement("div");
  item.className = "detail";
  const caption = document.createElement("span");
  caption.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value || "Not provided";
  item.append(caption, content);
  parent.appendChild(item);
}

function materialCard(material, includeDelete = false) {
  const card = document.createElement("article");
  card.className = "material-card";
  const top = document.createElement("div");
  top.className = "material-top";
  const icon = document.createElement("span");
  icon.className = "pdf-icon";
  icon.textContent = "PDF";
  const titleWrap = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = material.title;
  const subject = document.createElement("p");
  subject.className = "small";
  subject.textContent = material.subject;
  titleWrap.append(title, subject);
  top.append(icon, titleWrap);

  const meta = document.createElement("div");
  meta.className = "material-meta";
  [
    ["College", material.college],
    ...(material.location ? [["Location", material.location]] : []),
    ["Department / semester", [material.department, material.semester].filter(Boolean).join(" · ") || "Not provided"],
    ["Uploaded by", material.uploader || "Student"],
    ["PDF", material.filename]
  ].forEach(([label, value]) => {
    const line = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    line.append(strong, document.createTextNode(value));
    meta.appendChild(line);
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  const download = document.createElement("a");
  download.className = "button";
  download.href = material.data;
  download.download = material.filename;
  download.textContent = "Download PDF";
  download.addEventListener("click", () => rememberDownload(material.id));
  actions.appendChild(download);
  const email = currentUser();
  const save = document.createElement("button");
  save.type = "button";
  save.className = "save-material";
  save.setAttribute("aria-pressed", String(Boolean(email && getFavoriteIds(email).includes(material.id))));
  save.textContent = save.getAttribute("aria-pressed") === "true" ? "Saved - remove" : "Save material";
  save.addEventListener("click", () => toggleFavorite(material.id));
  actions.appendChild(save);
  if (includeDelete) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-material";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteMaterial(material.id));
    actions.appendChild(remove);
  }
  card.append(top, meta, actions);
  return card;
}

function toggleFavorite(id) {
  const email = currentUser();
  if (!email) {
    sessionStorage.setItem("eduShareRedirect", "materials.html");
    location.href = "login.html?required=1";
    return;
  }
  const favorites = readStorage(STORAGE.favorites, {});
  const ids = Array.isArray(favorites[email]) ? favorites[email] : [];
  favorites[email] = ids.includes(id) ? ids.filter(favoriteId => favoriteId !== id) : [...ids, id];
  if (!writeStorage(STORAGE.favorites, favorites)) {
    console.error("Could not save this material to the student's favorites.");
    return;
  }
  displayMaterials();
  displaySavedMaterials();
  loadDashboard();
}

function displaySavedMaterials() {
  const list = document.getElementById("saved-materials");
  if (!list) return;
  const favoriteIds = new Set(getFavoriteIds());
  const saved = getNotes()
    .filter(material => favoriteIds.has(material.id))
    .sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));
  list.replaceChildren();
  if (!saved.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const message = document.createElement("p");
    message.textContent = "You haven't saved any materials yet. Browse the library and select Save material on a resource you want to keep.";
    const browse = document.createElement("a");
    browse.className = "button";
    browse.href = "materials.html";
    browse.textContent = "Explore materials";
    empty.append(message, browse);
    list.appendChild(empty);
    return;
  }
  saved.forEach(material => list.appendChild(materialCard(material)));
}

function renderMaterialList(list, materials, emptyMessage, includeDelete = false) {
  if (!list) return;
  list.replaceChildren();
  if (!materials.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return;
  }
  materials.forEach(material => list.appendChild(materialCard(material, includeDelete)));
}

function rememberDownload(id) {
  const downloads = readStorage(STORAGE.downloads, {});
  const email = currentUser();
  downloads[email] = [...new Set([...(downloads[email] || []), id])];
  writeStorage(STORAGE.downloads, downloads);
}

function deleteMaterial(id) {
  if (!window.confirm("Delete this uploaded material?")) return;
  if (writeStorage(STORAGE.materials, getNotes().filter(item => item.id !== id))) {
    displayMaterials();
    loadDashboard();
    loadProfile();
  }
}

function displayMaterials() {
  const list = document.getElementById("material-list");
  if (!list) return;
  const query = document.getElementById("search").value.trim().toLowerCase();
  const collegeFilter = document.getElementById("college-filter").value.trim().toLowerCase();
  const subjectFilter = document.getElementById("subject-filter").value.trim().toLowerCase();
  const materials = getNotes().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const colleges = [...new Set(materials.map(item => String(item.college || "").trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  const subjects = [...new Set(materials.map(item => String(item.subject || "").trim()).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second));
  updateDatalist("college-options", colleges);
  updateDatalist("subject-options", subjects);
  const filtered = materials.filter(item =>
    [item.title, item.subject, item.college, item.location, item.uploader, item.department, item.semester, item.filename]
      .some(value => String(value || "").toLowerCase().includes(query)) &&
    (!collegeFilter || String(item.college || "").toLowerCase().includes(collegeFilter)) &&
    (!subjectFilter || String(item.subject || "").toLowerCase().includes(subjectFilter))
  );
  list.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = materials.length ? "No materials match your search. Try another subject or college." : "No PDFs yet. Be the first to share a study material.";
    list.appendChild(empty);
    return;
  }
  const email = currentUser();
  filtered.forEach(item => list.appendChild(materialCard(item, item.owner === email)));
}

function updateDatalist(id, options) {
  const datalist = document.getElementById(id);
  if (!datalist) return;
  datalist.replaceChildren(...options.map(value => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
}

function loadDashboard() {
  const welcome = document.getElementById("welcome");
  if (!welcome) return;
  const student = currentStudent();
  const notes = getNotes();
  const mine = notes.filter(item => item.owner === student.email);
  const downloads = readStorage(STORAGE.downloads, {})[student.email] || [];
  const favoriteCount = getFavoriteIds(student.email).length;
  welcome.textContent = `Welcome back, ${student.name}`;
  const context = document.getElementById("student-context");
  if (context) {
    context.textContent = [student.college, student.department, student.year, student.semester]
      .filter(Boolean)
      .join(" · ");
  }
  document.getElementById("total-materials").textContent = String(notes.length);
  document.getElementById("my-uploads").textContent = String(mine.length);
  document.getElementById("my-downloads").textContent = String(downloads.length);
  const savedCount = document.getElementById("saved-count");
  if (savedCount) savedCount.textContent = String(favoriteCount);
  const latest = [...notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const campusMaterials = student.college
    ? latest.filter(item =>
      item.owner !== student.email &&
      String(item.college || "").trim().toLocaleLowerCase() === student.college.trim().toLocaleLowerCase()
    )
    : [];
  renderMaterialList(
    document.getElementById("college-materials"),
    campusMaterials.slice(0, 3),
    student.college
      ? `No materials from ${student.college} yet. Explore the library to browse other resources.`
      : "Add your college to your profile to see materials from your campus here."
  );
  renderMaterialList(
    document.getElementById("my-uploaded-materials"),
    mine.slice(0, 3),
    "You haven't uploaded any materials yet. Upload a PDF to share it with students.",
    true
  );
  const downloadedList = document.getElementById("downloaded-materials");
  if (downloadedList) {
    const downloadedMaterials = notes.filter(item => downloads.includes(item.id));
    renderMaterialList(downloadedList, downloadedMaterials, "PDFs you download will appear here.");
  }
}

function renderProfile() {
  const details = document.getElementById("profile-details");
  if (!details) return;
  const student = currentStudent();
  details.replaceChildren();
  [
    ["Student name", student.name],
    ["College", student.college],
    ["Roll number", student.roll],
    ["Department", student.department],
    ["Year", student.year],
    ["Semester", student.semester],
    ["Email", student.email],
    ["Phone", student.phone],
    ["Current location", student.location]
  ].forEach(([label, value]) => addDetail(details, label, value));
  const mine = document.getElementById("my-materials");
  mine.replaceChildren();
  const ownMaterials = getNotes().filter(item => item.owner === student.email);
  if (!ownMaterials.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "You haven't uploaded any PDFs yet.";
    mine.appendChild(empty);
  } else {
    ownMaterials.forEach(item => mine.appendChild(materialCard(item, true)));
  }
}

function toggleProfileEditor() {
  const editor = document.getElementById("profile-editor");
  if (!editor) return;
  editor.classList.toggle("hidden");
  if (editor.classList.contains("hidden")) return;
  const student = currentStudent();
  updateCollegePicker("edit-college-select", "edit-college-custom-field", student.college || "");
  ["name", "roll", "department", "year", "semester", "phone", "location"].forEach(key => {
    const field = editor.elements.namedItem(key);
    if (field) field.value = student[key] || "";
  });
}

function saveProfile(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const student = currentStudent();
  const updatedRoll = String(data.get("roll")).trim().toLowerCase();
  const updatedPhone = String(data.get("phone")).trim();
  const conflict = getUsers().some(user => user.email !== student.email &&
    (String(user.roll || "").toLowerCase() === updatedRoll || String(user.phone || "") === updatedPhone));
  if (conflict) {
    setMessage(document.getElementById("profile-message"), "That phone number or roll number is already used by another student.", true);
    return;
  }
  const users = getUsers().map(user => user.email === student.email
    ? {
      ...user,
      ...Object.fromEntries(["name", "roll", "department", "year", "semester", "phone", "location"].map(key => [key, String(data.get(key) || "").trim()])),
      college: selectedCollege("edit-college-select", "edit-college-custom-field")
    }
    : user);
  if (!writeStorage(STORAGE.users, users)) {
    setMessage(document.getElementById("profile-message"), "Profile changes could not be saved.", true);
    return;
  }
  setMessage(document.getElementById("profile-message"), "Profile updated.");
  renderProfile();
  document.getElementById("welcome")?.replaceChildren(document.createTextNode(`Welcome back, ${currentStudent().name}`));
  event.currentTarget.classList.add("hidden");
}

function showPasswordHelp() {
  setMessage(document.getElementById("login-message"), "Forgot password? Password recovery requires an email service. This browser-only demo cannot send a reset link.", true);
}

function initializePage() {
  const particles = document.createElement("div");
  particles.className = "particles";
  particles.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 6; index += 1) particles.appendChild(document.createElement("span"));
  document.body.prepend(particles);

  document.querySelectorAll(".site-nav a[data-page]").forEach(link => {
    if (link.dataset.page === document.body.dataset.page) link.setAttribute("aria-current", "page");
  });
  if (!requireLogin()) return;

  document.getElementById("register-form")?.addEventListener("submit", register);
  document.getElementById("login-form")?.addEventListener("submit", login);
  document.getElementById("start-face-check")?.addEventListener("click", startFaceCheck);
  window.addEventListener("pagehide", stopFaceCheck);
  document.getElementById("upload-form")?.addEventListener("submit", saveMaterial);
  document.getElementById("profile-editor")?.addEventListener("submit", saveProfile);
  document.getElementById("edit-profile")?.addEventListener("click", toggleProfileEditor);
  document.querySelectorAll("#logout-button, #logout-button-copy").forEach(button => button.addEventListener("click", logout));
  document.getElementById("forgot-password")?.addEventListener("click", showPasswordHelp);
  document.getElementById("search")?.addEventListener("input", displayMaterials);
  document.getElementById("college-filter")?.addEventListener("input", displayMaterials);
  document.getElementById("subject-filter")?.addEventListener("input", displayMaterials);
  if (document.body.dataset.page === "dashboard") loadDashboard();
  if (document.body.dataset.page === "materials") displayMaterials();
  if (document.body.dataset.page === "profile") renderProfile();
  if (document.body.dataset.page === "saved") displaySavedMaterials();
  if (document.body.dataset.page === "account") updateCollegePicker("college-select", "college-custom-field");
  if (document.body.dataset.page === "upload") {
    updateCollegePicker("college-select", "college-custom-field", currentStudent().college || "");
    updateSubjectPicker();
  }
  initializeLocationControls();
  if (document.body.dataset.page === "login") {
    document.getElementById("login-submit").disabled = !faceCheckPassed;
  }
  if (new URLSearchParams(location.search).has("required")) {
    setMessage(document.getElementById("login-message"), "Please register or log in to access your student dashboard.", true);
  }
}

document.addEventListener("DOMContentLoaded", initializePage);
