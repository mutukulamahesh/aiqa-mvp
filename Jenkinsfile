pipeline {
    agent any

    options {
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
    }

    parameters {
        choice(
            name: 'ENVIRONMENT',
            choices: ['staging', 'prod'],
            description: 'Target environment profile'
        )
        string(
            name: 'WORKERS',
            defaultValue: '2',
            description: 'Parallel worker count (CI machines are smaller than local)'
        )
        string(
            name: 'CIRCUIT_BREAKER',
            defaultValue: '5',
            description: 'Abort after N consecutive failures'
        )
        string(
            name: 'TAGS',
            defaultValue: '',
            description: 'Comma-separated tag filter (leave blank to run all)'
        )
    }

    environment {
        ANTHROPIC_API_KEY = credentials('anthropic-api-key')
        NODE_ENV          = 'ci'
        RESULTS_DIR       = 'results'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Install') {
            steps {
                sh 'node --version && npm --version'
                sh 'npm ci'
                sh 'npx playwright install --with-deps chromium'
            }
        }

        stage('Run Tests') {
            steps {
                script {
                    def tagFlag = params.TAGS?.trim()
                        ? "--tags ${params.TAGS.trim()}"
                        : ''

                    sh """
                        npx ts-node src/cli.ts \\
                            --env ${params.ENVIRONMENT} \\
                            run-all tests/ \\
                            --headless \\
                            --workers ${params.WORKERS} \\
                            --out ${env.RESULTS_DIR} \\
                            --circuit-breaker ${params.CIRCUIT_BREAKER} \\
                            ${tagFlag}
                    """
                }
            }
        }
    }

    post {
        always {
            publishHTML(target: [
                allowMissing:           true,
                alwaysLinkToLastBuild:  true,
                keepAll:                true,
                reportDir:              "${env.RESULTS_DIR}/results",
                reportFiles:            'report.html',
                reportName:             "AIQA Report — ${params.ENVIRONMENT}"
            ])

            archiveArtifacts(
                artifacts:          "${env.RESULTS_DIR}/results/run-*.json, ${env.RESULTS_DIR}/screenshots/**",
                allowEmptyArchive:  true
            )
        }

        failure {
            echo "AIQA suite failed on ${params.ENVIRONMENT}. Check the HTML report artifact."
        }

        success {
            echo "All tests passed on ${params.ENVIRONMENT}."
        }

        cleanup {
            cleanWs(
                cleanWhenSuccess:    false,
                cleanWhenFailure:    false,
                cleanWhenAborted:    true,
                deleteDirs:          true,
                notFailBuild:        true,
                patterns: [[pattern: 'node_modules', type: 'INCLUDE']]
            )
        }
    }
}
