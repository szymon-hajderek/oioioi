import "@github/markdown-toolbar-element";
import { marked } from "marked";

// Turns a <textarea> into a Markdown editor: a toolbar and Write/Preview tabs.
// The textarea stays a regular form field, so forms and their scripts see it as before.
//
// Options:
//     - 'render': a function taking the Markdown text and returning the preview HTML,
//       or a Promise of it (default: render in the browser with marked),
//     - 'buttons': extra toolbar buttons, objects with 'title', 'icon' (Font Awesome classes),
//       'wrap' ([prefix, suffix] put around the selection) and optionally 'placeholder'
//       (put between them and selected if nothing is selected).

const STANDARD_BUTTONS = [
    ["md-header", "fa-heading", () => gettext("Heading")],
    ["md-bold", "fa-bold", () => gettext("Bold")],
    ["md-italic", "fa-italic", () => gettext("Italic")],
    ["md-link", "fa-link", () => gettext("Link")],
    ["md-image", "fa-image", () => gettext("Image")],
    ["md-unordered-list", "fa-list-ul", () => gettext("Bulleted list")],
    ["md-ordered-list", "fa-list-ol", () => gettext("Numbered list")],
    ["md-code", "fa-code", () => gettext("Code")],
    ["md-quote", "fa-quote-right", () => gettext("Quote")],
];

let editorCount = 0;

function createElement(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    element.className = className;
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    return element;
}

function createIconButton(tag, title, icon) {
    const button = createElement(tag, "btn btn-sm btn-outline-secondary border-0", { title: title, "aria-label": title });
    if (tag === "button") {
        button.type = "button";
    } else {
        // The md-* elements don't set it themselves.
        button.setAttribute("role", "button");
    }
    button.appendChild(createElement("i", "fa-solid " + icon, { "aria-hidden": "true" }));
    return button;
}

function createTab(label) {
    const tab = createElement("button", "nav-link", { type: "button", role: "tab" });
    tab.textContent = label;
    return tab;
}

// Puts 'prefix' and 'suffix' around the textarea's selection (or around 'placeholder'
// if nothing is selected) and selects what is between them.
function wrapSelection(textarea, prefix, suffix, placeholder) {
    const start = textarea.selectionStart;
    const selected = textarea.value.slice(start, textarea.selectionEnd) || placeholder;
    const text = prefix + selected + suffix;

    textarea.focus();
    // execCommand is deprecated, but it is the only way to keep the browser's undo history.
    let inserted = false;
    try {
        inserted = document.execCommand("insertText", false, text);
    } catch (error) {
        console.error(error);
    }
    if (!inserted) {
        textarea.setRangeText(text);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
}

window.initMarkdownEditor = function (textarea, options = {}) {
    const render = options.render || ((text) => marked.parse(text));
    const buttons = options.buttons || [];
    for (const button of buttons) {
        if (!Array.isArray(button.wrap) || button.wrap.length !== 2) {
            throw new Error("Markdown editor button '" + button.title + "' needs 'wrap': [prefix, suffix]");
        }
    }
    if (!textarea.id) {
        textarea.id = "markdown-editor-" + ++editorCount;
    }

    const editor = createElement("div", "md-editor");
    const tabs = createElement("ul", "nav nav-tabs", { role: "tablist" });
    const toolbar = createElement("markdown-toolbar", "md-toolbar", { for: textarea.id });
    const preview = createElement("div", "md-preview", { role: "tabpanel" });

    const tabsByMode = { write: createTab(gettext("Write")), preview: createTab(gettext("Preview")) };
    for (const tab of Object.values(tabsByMode)) {
        const item = createElement("li", "nav-item", { role: "presentation" });
        item.appendChild(tab);
        tabs.appendChild(item);
    }

    const standardGroup = createElement("div", "md-toolbar-group");
    for (const [tag, icon, title] of STANDARD_BUTTONS) {
        standardGroup.appendChild(createIconButton(tag, title(), icon));
    }
    toolbar.appendChild(standardGroup);
    if (buttons.length) {
        const customGroup = createElement("div", "md-toolbar-group");
        for (const button of buttons) {
            const element = createIconButton("button", button.title, button.icon);
            element.setAttribute("data-md-button", "");
            element.addEventListener("click", () => wrapSelection(textarea, button.wrap[0], button.wrap[1], button.placeholder || ""));
            customGroup.appendChild(element);
        }
        toolbar.appendChild(customGroup);
    }
    // Text inserted by a script does not make the textarea fire 'change',
    // which e.g. the translation formset listens for.
    toolbar.addEventListener("click", () => textarea.dispatchEvent(new Event("change", { bubbles: true })));

    textarea.before(editor);
    editor.append(tabs, toolbar, textarea, preview);

    let mode = null;

    // Shows the tab of 'newMode' ("write" or "preview") and what belongs to it.
    function switchMode(newMode) {
        if (newMode === "preview") {
            // Take the place of the toolbar and the textarea, so the page does not jump.
            preview.style.minHeight = toolbar.offsetHeight + textarea.offsetHeight + "px";
        }
        mode = newMode;
        for (const [tabMode, tab] of Object.entries(tabsByMode)) {
            tab.classList.toggle("active", tabMode === mode);
            tab.setAttribute("aria-selected", tabMode === mode ? "true" : "false");
        }
        toolbar.hidden = mode === "preview";
        textarea.hidden = mode === "preview";
        preview.hidden = mode !== "preview";
    }

    // Each preview request gets a number; its response is shown only if no newer
    // request was made and the preview was not cancelled in the meantime.
    let previewRequest = 0;

    function cancelPreview() {
        ++previewRequest;
    }

    async function renderPreview() {
        const request = ++previewRequest;
        preview.textContent = gettext("Loading...");

        let html;
        try {
            html = await render(textarea.value);
        } catch (error) {
            console.error(error);
            if (request === previewRequest) {
                const message = createElement("span", "text-danger");
                message.textContent = gettext("Could not render the preview.");
                preview.replaceChildren(message);
            }
            return;
        }
        if (request !== previewRequest) {
            return;
        }
        const mathJax = window.MathJax;
        if (mathJax && mathJax.typesetClear) {
            mathJax.typesetClear([preview]);
        }
        preview.innerHTML = html;
        if (mathJax && mathJax.typesetPromise) {
            try {
                await mathJax.typesetPromise([preview]);
            } catch (error) {
                // The preview stays, only with the TeX source in place of the math.
                console.error(error);
            }
        }
    }

    tabsByMode.write.addEventListener("click", () => {
        if (mode !== "write") {
            cancelPreview();
            switchMode("write");
            textarea.focus();
        }
    });
    tabsByMode.preview.addEventListener("click", () => {
        if (mode !== "preview") {
            switchMode("preview");
            renderPreview();
        }
    });

    switchMode("write");
};
