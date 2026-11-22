import "@github/markdown-toolbar-element";
import { marked } from "marked";

// Turns a <textarea> into a Markdown editor: a toolbar and Write/Preview tabs.
// The textarea stays a regular form field, so forms and their scripts see it as before.
//
// Options:
//     - 'render': a function taking the Markdown text and returning the preview HTML,
//       or a Promise of it (default: render in the browser with marked),
//     - 'buttons': extra toolbar buttons, objects with 'title', 'icon' (Font Awesome classes)
//       and either 'insert' (text replacing the selection) or 'wrap' ([prefix, suffix] put
//       around the selection, or around 'placeholder' if nothing is selected).

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

function createButton(tag, title, icon) {
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

// Replaces the textarea's selection with 'text' and selects the range
// [start, end) of the inserted text (the cursor goes after it by default).
function replaceSelection(textarea, text, start = text.length, end = start) {
    const offset = textarea.selectionStart;
    textarea.focus();
    // execCommand keeps the browser's undo history; setRangeText is the fallback.
    if (!document.execCommand("insertText", false, text)) {
        textarea.setRangeText(text);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.setSelectionRange(offset + start, offset + end);
}

function applyButton(textarea, button) {
    if (button.insert !== undefined) {
        replaceSelection(textarea, button.insert);
    } else {
        const [prefix, suffix] = button.wrap;
        const selected = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) || button.placeholder || "";
        replaceSelection(textarea, prefix + selected + suffix, prefix.length, prefix.length + selected.length);
    }
}

window.initMarkdownEditor = function (textarea, options = {}) {
    const render = options.render || ((text) => marked.parse(text));
    if (!textarea.id) {
        textarea.id = "markdown-editor-" + ++editorCount;
    }

    const editor = createElement("div", "md-editor");
    const tabs = createElement("ul", "nav nav-tabs", { role: "tablist" });
    const toolbar = createElement("markdown-toolbar", "md-toolbar", { for: textarea.id });
    const preview = createElement("div", "md-preview", { role: "tabpanel" });
    preview.hidden = true;

    const writeTab = createElement("button", "nav-link active", { type: "button", role: "tab", "aria-selected": "true" });
    writeTab.textContent = gettext("Write");
    const previewTab = createElement("button", "nav-link", { type: "button", role: "tab", "aria-selected": "false" });
    previewTab.textContent = gettext("Preview");
    for (const tab of [writeTab, previewTab]) {
        const item = createElement("li", "nav-item", { role: "presentation" });
        item.appendChild(tab);
        tabs.appendChild(item);
    }

    const standardGroup = createElement("div", "md-toolbar-group");
    for (const [tag, icon, title] of STANDARD_BUTTONS) {
        standardGroup.appendChild(createButton(tag, title(), icon));
    }
    toolbar.appendChild(standardGroup);
    if (options.buttons && options.buttons.length) {
        const customGroup = createElement("div", "md-toolbar-group");
        for (const button of options.buttons) {
            const element = createButton("button", button.title, button.icon);
            element.setAttribute("data-md-button", "");
            element.addEventListener("click", () => applyButton(textarea, button));
            customGroup.appendChild(element);
        }
        toolbar.appendChild(customGroup);
    }
    // Text inserted by a script does not make the textarea fire 'change',
    // which e.g. the translation formset listens for.
    toolbar.addEventListener("click", () => textarea.dispatchEvent(new Event("change", { bubbles: true })));

    textarea.before(editor);
    editor.append(tabs, toolbar, textarea, preview);

    // Responses to older preview requests are ignored.
    let previewRequest = 0;

    async function showPreview() {
        const request = ++previewRequest;
        // Take the place of the toolbar and the textarea, so the page does not jump.
        preview.style.minHeight = toolbar.offsetHeight + textarea.offsetHeight + "px";
        textarea.hidden = true;
        toolbar.hidden = true;
        preview.hidden = false;
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
            await mathJax.typesetPromise([preview]);
        }
    }

    function showWrite() {
        ++previewRequest;
        preview.hidden = true;
        textarea.hidden = false;
        toolbar.hidden = false;
        textarea.focus();
    }

    function selectTab(tab) {
        if (tab.classList.contains("active")) {
            return;
        }
        for (const other of [writeTab, previewTab]) {
            other.classList.toggle("active", other === tab);
            other.setAttribute("aria-selected", other === tab ? "true" : "false");
        }
        if (tab === previewTab) {
            showPreview();
        } else {
            showWrite();
        }
    }

    writeTab.addEventListener("click", () => selectTab(writeTab));
    previewTab.addEventListener("click", () => selectTab(previewTab));
};
