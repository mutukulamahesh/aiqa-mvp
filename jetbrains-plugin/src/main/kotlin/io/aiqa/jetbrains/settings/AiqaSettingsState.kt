package io.aiqa.jetbrains.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "AiqaSettings", storages = [Storage("aiqa.xml")])
class AiqaSettingsState : PersistentStateComponent<AiqaSettingsState> {
    var serverUrl: String = "http://localhost:7432"
    var apiKey:    String = ""
    var headless:  Boolean = true

    override fun getState(): AiqaSettingsState = this

    override fun loadState(state: AiqaSettingsState) {
        serverUrl = state.serverUrl
        apiKey    = state.apiKey
        headless  = state.headless
    }

    companion object {
        val instance: AiqaSettingsState
            get() = ApplicationManager.getApplication().getService(AiqaSettingsState::class.java)
    }
}
