package io.aiqa.gradle

import org.gradle.api.Plugin
import org.gradle.api.Project

class AiqaPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val ext = project.extensions.create("aiqa", AiqaExtension::class.java)
        project.tasks.register("aiqaRun", AiqaRunTask::class.java) { task ->
            task.testPath.convention(ext.testPath)
            task.headless.convention(ext.headless)
            task.workers.convention(ext.workers)
            task.env.convention(ext.env)
            task.tags.convention(ext.tags)
            task.circuitBreaker.convention(ext.circuitBreaker)
            task.failBuild.convention(ext.failBuild)
        }
    }
}
