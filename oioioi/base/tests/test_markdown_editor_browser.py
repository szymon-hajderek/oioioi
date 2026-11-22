from django.urls import reverse

from oioioi.base.tests import BrowserTestCase
from oioioi.newsfeed.models import NewsLanguageVersion
from oioioi.portals.actions import portal_url
from oioioi.portals.models import Portal


class TestMarkdownEditor(BrowserTestCase):
    fixtures = ["test_users", "test_portals"]

    def open(self, url, username):
        context = self.new_browser_context(username)
        self.addCleanup(context.close)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        self.addCleanup(lambda: self.assertEqual(errors, []))
        page.goto(self.live_server_url + url)
        page.locator(".md-editor").first.wait_for()
        return page

    def test_news_preview(self):
        page = self.open(reverse("add_news"), "test_admin")
        editor = page.locator(".md-editor").first
        textarea = editor.locator("textarea")
        textarea.fill("Some **news** text.")

        editor.get_by_role("tab", name="Preview").click()
        self.assertEqual(editor.locator(".md-preview strong").inner_text(), "news")
        self.assertTrue(textarea.is_hidden())

        editor.get_by_role("tab", name="Write").click()
        self.assertTrue(editor.locator(".md-preview").is_hidden())
        self.assertEqual(textarea.input_value(), "Some **news** text.")

    def test_news_in_two_languages(self):
        page = self.open(reverse("add_news"), "test_admin")
        page.locator("#translation-formset .first-column [id$='-title']").fill("English title")
        page.locator("#translation-formset .first-column textarea").fill("English")

        page.locator("#translation-select").select_option("pl")
        form = page.locator("#form-pl")
        form.locator("[id$='-title']").fill("Polish title")
        textarea = form.locator("textarea")
        textarea.fill("Polish")
        textarea.select_text()
        form.get_by_role("button", name="Bold").click()
        self.assertEqual(textarea.input_value(), "**Polish**")

        page.get_by_role("button", name="Submit").click()
        page.wait_for_url("**" + reverse("newsfeed"))
        with self.server_lock:
            contents = dict(NewsLanguageVersion.objects.values_list("language", "content"))
        self.assertEqual(contents, {"en": "English", "pl": "**Polish**"})

    def test_portal_math_button_wraps_selection(self):
        page = self.open(portal_url(portal=Portal.objects.get(owner__username="test_user"), action="edit_node"), "test_user")
        editor = page.locator(".md-editor").first
        textarea = editor.locator("textarea")
        textarea.fill("x^2")
        textarea.select_text()

        editor.get_by_role("button", name="Inline math mode").click()
        self.assertEqual(textarea.input_value(), r"\\(x^2\\)")
        self.assertEqual(textarea.evaluate("t => t.value.slice(t.selectionStart, t.selectionEnd)"), "x^2")

        textarea.fill("")
        editor.get_by_role("button", name="Math mode", exact=True).click()
        self.assertEqual(textarea.input_value(), "$$<mathjax>$$")

    def test_portal_preview_is_rendered_by_the_server(self):
        page = self.open(portal_url(portal=Portal.objects.get(owner__username="test_user"), action="edit_node"), "test_user")
        editor = page.locator(".md-editor").first
        editor.locator("textarea").fill("**bold** $$x^2$$")

        with page.expect_request(lambda request: request.url.endswith(reverse("render_markdown"))):
            editor.get_by_role("tab", name="Preview").click()
        preview = editor.locator(".md-preview")
        self.assertEqual(preview.locator("strong").inner_text(), "bold")
        # MathJax 4 replaces the TeX with an <mjx-container> element.
        preview.locator("mjx-container").wait_for()
