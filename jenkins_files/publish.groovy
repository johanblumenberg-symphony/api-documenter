#!/usr/bin/env groovy

@Library('SFE-RTC-pipeline') _

def tagParam = params.VERSION_TAG ? "--tag ${params.VERSION_TAG}" : ""

node {
    cleanWs()
    checkout scm

    try {
        withNvm("v12.14.0", "npmrcFile") {
            stage("Install") {
                sh "npm install"
            }
            stage("Step version") {
                sh "npm run step-version -- set ${tagParam}"
            }
            stage("Build") {
                sh "npm run build"
            }
            stage("Publish Packages") {
                if (sh(returnStatus: true, script: "npm run step-version -- list-changed --query")) {
                    sh "npm run step-version -- tag"

                    sh "npm run env | grep registry"
                    sh "npm publish"

                    withGitCredentials("githubaccess") {
                        sh "git push --tags"
                    }
                }
            }
        }
    } finally {
        cleanWs()
    }
}
