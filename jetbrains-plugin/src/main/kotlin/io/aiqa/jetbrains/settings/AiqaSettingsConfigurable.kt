package io.aiqa.jetbrains.settings

import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel

class AiqaSettingsConfigurable : Configurable {
    private val serverUrlField = JBTextField()
    private val apiKeyField    = JBTextField()
    private val headlessBox    = JBCheckBox("Run browser in headless mode")

    override fun getDisplayName(): String = "AIQA"

    override fun createComponent(): JComponent {
        return FormBuilder.createFormBuilder()
            .addLabeledComponent(JBLabel("Server URL:"), serverUrlField, 1, false)
            .addLabeledComponent(JBLabel("API Key:"),    apiKeyField,    1, false)
            .addComponent(headlessBox)
            .addComponentFillVertically(JPanel(), 0)
            .panel
    }

    override fun isModified(): Boolean {
        val s = AiqaSettingsState.instance
        return serverUrlField.text != s.serverUrl
            || apiKeyField.text != s.apiKey
            || headlessBox.isSelected != s.headless
    }

    override fun apply() {
        val s = AiqaSettingsState.instance
        s.serverUrl = serverUrlField.text
        s.apiKey    = apiKeyField.text
        s.headless  = headlessBox.isSelected
    }

    override fun reset() {
        val s = AiqaSettingsState.instance
        serverUrlField.text   = s.serverUrl
        apiKeyField.text      = s.apiKey
        headlessBox.isSelected = s.headless
    }
}
