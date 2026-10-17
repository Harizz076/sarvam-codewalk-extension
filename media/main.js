(function () {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  let model = vscode.getState() || null;
  let activeAudioUrl = null;

  function disposeAudio() {
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
    });
  }

  function primary(label, action, disabled) {
    return `<button class="primary" data-action="${action}"${disabled ? " disabled aria-disabled=\"true\"" : ""}>${label}</button>`;
  }

  function renderReady() {
    const action = model.isRecording ? primary("Stop speaking", "stopRecording") : primary("Start speaking", "startRecording");
    return `<section class="hero hero-minimal">${action}<a class="api-link" href="#" data-action="setSarvamApiKey">Update API key</a></section>`;
  }

  function renderReview() {
    const status = /^Transcript ready\./.test(model.status) ? "" : escapeHtml(model.status);
    return `<section class="transcript-review"><p class="phase-label">Transcript</p><textarea id="transcript" class="transcript-bubble" rows="4" aria-label="Romanized transcript">${escapeHtml(model.romanizedTranscript || model.task)}</textarea><div class="review-actions">${primary("Send", "useTranscript")}<button class="link-button warm-link" data-action="returnToReady">Re-record</button></div><p class="stage-status" role="status">${status}</p></section>`;
  }

  function renderConfirm() {
    return `<section class="translation-stage"><p class="phase-label">English translation</p><div class="translation-bubble">${escapeHtml(model.task)}</div><div class="review-actions">${primary("Send to agent", "runApprovedTask")}<button class="link-button warm-link" data-action="returnToReady">Re-record</button></div></section>`;
  }

  function renderWorking() {
    const steps = ["Planning", "Editing files", "Running checks", "Explaining"];
    const timeline = steps.map(function (step) { const index = model.progress.indexOf(step); return `<li class="${index >= 0 ? "complete" : ""} ${model.status === step ? "active" : ""}">${step}</li>`; }).join("");
    return `<section class="working-stage"><p class="phase-label">Working</p><h1>Following the task.</h1><ol class="timeline">${timeline}</ol><p class="working-note">Working in the folder open in VS Code.</p><p class="stage-status" role="status">${escapeHtml(model.status)}</p></section>`;
  }

  function renderLesson() {
    const limitation = model.lesson.limitation ? `<section><h2>Limitation</h2><p>${escapeHtml(model.lesson.limitation)}</p></section>` : "";
    const listening = Boolean(model.isGeneratingSpeech);
    return `<section class="agent-response"><p class="phase-label">Response</p><h1>${escapeHtml(model.lesson.taskRestatement)}</h1><article class="agent-message"><section><h2>What changed</h2><p>${escapeHtml(model.lesson.whatChanged)}</p></section><section><h2>Why</h2><p>${escapeHtml(model.lesson.why)}</p></section><section><h2>Concept</h2><p>${escapeHtml(model.lesson.concept)}</p></section><section><h2>Verification</h2><p>${escapeHtml(model.lesson.verification)}</p></section>${limitation}<section><h2>Try next</h2><p>${escapeHtml(model.lesson.tryNext)}</p></section></article><div class="result-actions">${primary(listening ? "Preparing audio…" : "Listen", "playLesson", listening)}<button class="warm-secondary" data-action="openFixtureFolder">Open workspace</button><button class="warm-secondary" data-action="continueSession">Continue session</button></div></section>`;
  }

  function render() {
    if (!app || !model) return;
    const states = { ready: renderReady, review: renderReview, confirm: renderConfirm, working: renderWorking, lesson: renderLesson };
    const quietStatus = /^(Ready(?: to record a new task)?\.|Recording|Transcript ready\.|English translation ready\.|Continue the session with a new task\.|Lesson ready(?: with an honest partial result)?\.|Spoken recap ready\.)/.test(model.status);
    const showStatus = model.state === "review" || model.state === "working" ? false : !quietStatus;
    app.classList.toggle("is-idle", model.state === "ready" && !showStatus);
    app.classList.toggle("is-review", model.state === "review");
    app.classList.toggle("is-translation", model.state === "confirm" && !showStatus);
    app.classList.toggle("is-working", model.state === "working");
    app.classList.toggle("is-result", model.state === "lesson" && !showStatus);
    app.innerHTML = `${states[model.state]()}${showStatus ? `<p class="status" role="status">${escapeHtml(model.status)}</p>` : ""}`;
    const primaryButton = app.querySelector(".primary");
    if (primaryButton && document.activeElement === document.body) primaryButton.focus();
  }

  document.addEventListener("click", function (event) {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!target) return;
    event.preventDefault();
    const action = target.getAttribute("data-action");
    if (action === "useTranscript") {
      const transcript = document.getElementById("transcript");
      vscode.postMessage({ type: "useTranscript", transcript: transcript && "value" in transcript ? transcript.value : "" });
      return;
    }
    if (action === "openChangedFile") {
      vscode.postMessage({ type: "openChangedFile", path: target.getAttribute("data-path") || "" });
      return;
    }
    if (action === "openSession") {
      vscode.postMessage({ type: "openSession", id: target.getAttribute("data-session-id") || "" });
      return;
    }
    if (["startRecording", "stopRecording", "returnToReady", "runApprovedTask", "playLesson", "continueSession", "useNextExercise", "setSarvamApiKey", "openFixtureFolder", "deleteSession", "clearHistory"].includes(action)) {
      vscode.postMessage({ type: action });
    }
  });

  window.addEventListener("message", function (event) {
    const message = event.data;
    if (message && message.type === "state" && message.model) {
      model = message.model;
      vscode.setState(model);
      render();
    }
    if (message && message.type === "audio" && typeof message.base64 === "string") {
      disposeAudio();
      const binary = atob(message.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: message.mimeType || "audio/wav" }));
      activeAudioUrl = url;
      const audio = new Audio(url);
      audio.addEventListener("ended", disposeAudio);
      audio.addEventListener("error", disposeAudio);
      void audio.play().catch(disposeAudio);
    }
    if (message && message.type === "disposeAudio") disposeAudio();
  });

  window.addEventListener("unload", disposeAudio);

  render();
  vscode.postMessage({ type: "webviewReady" });
}());
