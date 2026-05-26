package io.aiqa.jetbrains.toolwindow

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import io.aiqa.jetbrains.client.RunMeta
import java.awt.BorderLayout
import java.awt.Font
import javax.swing.JPanel
import javax.swing.SwingConstants

class ResultsToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel   = ResultsToolWindow()
        val content = ContentFactory.getInstance()
            .createContent(panel, "Results", false)
        toolWindow.contentManager.addContent(content)
    }
}

class ResultsToolWindow : JPanel(BorderLayout()) {
    private val label = JBLabel("No runs yet — right-click a YAML file → Run with AIQA", SwingConstants.CENTER)

    init {
        label.font = label.font.deriveFont(Font.PLAIN, 13f)
        add(label, BorderLayout.CENTER)
    }

    fun update(meta: RunMeta?, error: String? = null) {
        label.text = when {
            error != null        -> "❌ Error: $error"
            meta == null         -> "Waiting for results…"
            meta.status == "passed" -> buildSummary("✅ PASSED", meta)
            meta.status == "failed" -> buildSummary("❌ FAILED", meta)
            meta.isFinished      -> "⚠️ ${meta.status.uppercase()} — run ${meta.runId}"
            else                 -> "⏳ Running… (${meta.status})"
        }
        revalidate(); repaint()
    }

    private fun buildSummary(prefix: String, meta: RunMeta): String {
        val s = meta.summary
        return if (s != null) "$prefix — Passed: ${s.passed}  Failed: ${s.failed}  Total: ${s.total}"
        else "$prefix — run ${meta.runId}"
    }
}
