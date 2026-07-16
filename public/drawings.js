const form = document.querySelector("#drawingForm");
const artistInput = document.querySelector("#artistInput");
const titleInput = document.querySelector("#titleInput");
const fileInput = document.querySelector("#drawingFile");
const previewImage = document.querySelector("#previewImage");
const submitButton = document.querySelector("#submitDrawing");
const formStatus = document.querySelector("#formStatus");
const gallery = document.querySelector("#drawingGallery");
const refreshGallery = document.querySelector("#refreshGallery");

let imageDataUrl = "";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cleanText(value, fallback) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const maxSide = 1100;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext("2d");
        context.fillStyle = "#fbf6df";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };

      image.onerror = () => reject(new Error("Could not read that image."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function renderDrawings(drawings) {
  gallery.innerHTML = drawings.length
    ? drawings.map((drawing) => `
      <article class="drawing-card">
        <img src="${escapeHtml(drawing.imageDataUrl)}" alt="${escapeHtml(drawing.title)}">
        <div class="drawing-body">
          <h3>${escapeHtml(drawing.title)}</h3>
          <div class="drawing-meta">
            <span>By ${escapeHtml(drawing.artist)}</span>
            <span class="badge">${escapeHtml(drawing.statusLabel || drawing.status)}</span>
          </div>
          <p>${escapeHtml(drawing.aiFeedback || "Waiting for a pigeon art verdict.")}</p>
        </div>
      </article>
    `).join("")
    : "No pigeon drawings yet.";
}

async function loadDrawings() {
  try {
    const response = await fetch("/api/drawings");

    if (!response.ok) throw new Error("Could not load drawings.");

    const data = await response.json();
    renderDrawings(data.drawings || []);
  } catch (error) {
    gallery.textContent = "Could not load the drawing gallery.";
  }
}

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files;
  imageDataUrl = "";
  previewImage.hidden = true;

  if (!file) return;

  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    formStatus.textContent = "Please choose a PNG, JPG, or WebP image.";
    fileInput.value = "";
    return;
  }

  formStatus.textContent = "Preparing image...";

  try {
    imageDataUrl = await resizeImage(file);
    previewImage.src = imageDataUrl;
    previewImage.hidden = false;
    formStatus.textContent = "Ready to submit.";
  } catch (error) {
    formStatus.textContent = error.message;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!imageDataUrl) {
    formStatus.textContent = "Choose a drawing image first.";
    return;
  }

  submitButton.disabled = true;
  formStatus.textContent = "Submitting and checking the drawing...";

  try {
    const response = await fetch("/api/drawings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artist: cleanText(artistInput.value, "Anonymous artist"),
        title: cleanText(titleInput.value, "Untitled pigeon"),
        imageDataUrl
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "The drawing could not be accepted.");
    }

    form.reset();
    imageDataUrl = "";
    previewImage.hidden = true;
    formStatus.textContent = data.message || "Drawing submitted.";
    await loadDrawings();
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

refreshGallery.addEventListener("click", loadDrawings);
loadDrawings();
