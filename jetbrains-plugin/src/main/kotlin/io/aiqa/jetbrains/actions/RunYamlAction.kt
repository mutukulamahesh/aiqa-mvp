package io.aiqa.jetbrains.actions

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager
import io.aiqa.jetbrains.client.AiqaRestClient
import io.aiqa.jetbrains.client.RunMeta
import io.aiqa.jetbrains.toolwindow.ResultsToolWindow

class RunYamlAction : AnAction() {

    private val client = AiqaRestClient()

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        e.presentation.isEnabledAndVisible =
            file != null && (file.extension == "yaml" || file.extension == "yml")
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project  = e.project ?: return
        val file     = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val filePath = file.path

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "AIQA: Running ${file.name}", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    indicator.text = "Submitting to AIQA server…"
                    val accepted = client.runFile(filePath)

                    indicator.text = "Waiting for results…"
                    val deadline  = System.currentTimeMillis() + 300_000L
                    var intervalMs = 2_000L
                    var meta: RunMeta? = null
                    while (System.currentTimeMillis() < deadline) {
                        if (indicator.isCanceled) return
                        meta = client.getRun(accepted.runId)
                        showInToolWindow(project, meta)
                        if (meta.isFinished) break
                        Thread.sleep(intervalMs)
                        intervalMs = minOf(intervalMs * 2, 10_000L)
                    }
                    meta?.let { showInToolWindow(project, it) }
                } catch (ex: Exception) {
                    showInToolWindow(project, null, ex.message ?: "Unknown error")
                }
            }
        })
    }

    private fun showInToolWindow(project: Project, meta: RunMeta?, error: String? = null) {
        com.intellij.openapi.application.ApplicationManager.getApplication().invokeLater {
            val tw = ToolWindowManager.getInstance(project).getToolWindow("AIQA") ?: return@invokeLater
            tw.show()
            val content = tw.contentManager.findContent("Results") ?: return@invokeLater
            (content.component as? ResultsToolWindow)?.update(meta, error)
        }
    }
}
