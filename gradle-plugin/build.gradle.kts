plugins {
    `kotlin-dsl`
    `java-gradle-plugin`
}

group   = "io.aiqa"
version = "1.0.0"

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(11)
}

gradlePlugin {
    plugins {
        create("aiqa") {
            id                  = "io.aiqa.run"
            implementationClass = "io.aiqa.gradle.AiqaPlugin"
            displayName         = "AIQA Plugin"
            description         = "Run AIQA test suites from Gradle — ./gradlew aiqaRun"
        }
    }
}
