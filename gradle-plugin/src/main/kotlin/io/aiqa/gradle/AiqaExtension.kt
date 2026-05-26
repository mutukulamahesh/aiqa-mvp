package io.aiqa.gradle

import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.Property
import javax.inject.Inject

open class AiqaExtension @Inject constructor(objects: ObjectFactory) {
    val testPath:       Property<String>  = objects.property(String::class.java).convention("tests/")
    val headless:       Property<Boolean> = objects.property(Boolean::class.java).convention(true)
    val workers:        Property<Int>     = objects.property(Int::class.java).convention(1)
    val env:            Property<String>  = objects.property(String::class.java).convention("dev")
    val tags:           Property<String>  = objects.property(String::class.java).convention("")
    val circuitBreaker: Property<Int>     = objects.property(Int::class.java).convention(0)
    val failBuild:      Property<Boolean> = objects.property(Boolean::class.java).convention(true)
}
