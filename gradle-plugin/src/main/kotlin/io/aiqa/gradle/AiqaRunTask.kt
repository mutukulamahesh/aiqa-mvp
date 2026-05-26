package io.aiqa.gradle

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import java.io.File

/**
 * Runs an AIQA test suite via the Node CLI or Docker fallback.
 *
 * Usage in build.gradle.kts:
 *
 *   plugins { id("io.aiqa.run") version "1.0.0" }
 *
 *   aiqa {
 *     testPath       = "tests/"
 *     headless       = true
 *     workers        = 2
 *     env            = "staging"
 *     tags           = "smoke,regression"
 *     circuitBreaker = 5
 *   }
 *
 *   // Run with: ./gradlew aiqaRun
 */
abstract class AiqaRunTask : DefaultTask() {

    @get:Input abstract val testPath:       Property<String>
    @get:Input abstract val headless:       Property<Boolean>
    @get:Input abstract val workers:        Property<Int>
    @get:Input abstract val env:            Property<String>
    @get:Input abstract val tags:           Property<String>
    @get:Input abstract val circuitBreaker: Property<Int>
    @get:Input abstract val failBuild:      Property<Boolean>

    init {
        group       = "verification"
        description = "Run AIQA test suite (./gradlew aiqaRun)"
    }

    @TaskAction
    fun run() {
        val command = buildCommand()
        logger.lifecycle("[AIQA] Running: ${command.joinToString(" ")}")

        val pb = ProcessBuilder(command).apply {
            inheritIO()
            environment().putAll(System.getenv())
        }

        val exitCode = pb.start().waitFor()
        if (exitCode != 0 && failBuild.get()) {
            throw GradleException(
                "[AIQA] Tests failed (exit code $exitCode). " +
                "Set failBuild = false in the aiqa { } block to collect results without breaking the build."
            )
        }
    }

    private fun buildCommand(): List<String> {
        return when {
            isCommandAvailable("aiqa")   -> buildNodeCommand()
            isCommandAvailable("docker") -> {
                logger.lifecycle("[AIQA] 'aiqa' CLI not found — falling back to Docker")
                buildDockerCommand()
            }
            else -> {
                logger.warn(
                    "[AIQA] Neither 'aiqa' CLI nor 'docker' found. " +
                    "Install AIQA: curl -fsSL https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.sh | bash"
                )
                buildNodeCommand()
            }
        }
    }

    private fun buildNodeCommand(): List<String> {
        return buildList {
            add("aiqa"); add("--env"); add(env.get())
            add("run-all"); add(testPath.get())
            if (headless.get())               add("--headless")
            if (workers.get() > 1)            { add("--workers");        add(workers.get().toString()) }
            if (tags.get().isNotBlank())       { add("--tags");           add(tags.get()) }
            if (circuitBreaker.get() > 0)      { add("--circuit-breaker"); add(circuitBreaker.get().toString()) }
        }
    }

    private fun buildDockerCommand(): List<String> {
        val absTestPath = File(testPath.get()).let {
            if (it.isAbsolute) it.absolutePath
            else File(project.projectDir, testPath.get()).absolutePath
        }
        return buildList {
            addAll(listOf("docker", "run", "--rm", "-v", "$absTestPath:/tests", "aiqa/aiqa"))
            add("--env"); add(env.get())
            add("run-all"); add("/tests")
            add("--headless")
            if (workers.get() > 1)       { add("--workers");        add(workers.get().toString()) }
            if (tags.get().isNotBlank())  { add("--tags");           add(tags.get()) }
            if (circuitBreaker.get() > 0) { add("--circuit-breaker"); add(circuitBreaker.get().toString()) }
        }
    }

    private fun isCommandAvailable(command: String): Boolean {
        val pathEnv = System.getenv("PATH") ?: return false
        val isWindows = System.getProperty("os.name", "").lowercase().contains("win")
        val suffixes = if (isWindows) listOf(".cmd", ".exe", "") else listOf("")
        return pathEnv.split(File.pathSeparator).any { dir ->
            suffixes.any { suffix -> File(dir, command + suffix).canExecute() }
        }
    }
}
