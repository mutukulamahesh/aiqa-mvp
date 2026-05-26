plugins {
    id("org.jetbrains.intellij") version "1.17.2"
    kotlin("jvm") version "1.9.22"
}

group   = "io.aiqa"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.json:json:20240303")
}

intellij {
    version.set("2023.3")
    type.set("IC")                         // IntelliJ IDEA Community
    plugins.set(listOf("org.jetbrains.plugins.yaml"))
}

kotlin {
    jvmToolchain(17)
}

tasks {
    patchPluginXml {
        sinceBuild.set("233")              // 2023.3+
        untilBuild.set("")                 // open-ended — no upper bound
    }
}
