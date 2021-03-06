const core = require( '@actions/core' );
const github = require( '@actions/github' );
const handlebars = require( 'handlebars' );


async function run() {
	const githubToken = core.getInput('github-token');
	const artifactName = core.getInput('artifact-name') || null;
	const reportOn = core.getInput('report-on');
	const commitStatusContext = core.getInput('context');
	const message = core.getInput('message');
	const commitStatusText = core.getInput('state');
	const commitStatusTargetUrl = core.getInput('target-url');
	const octokit = github.getOctokit(githubToken);
	const ignoreEmpty = core.getInput("ignore-empty") === 'true';

	const {context} = github;

	const {owner, repo} = context.repo;

	if (!context.payload.workflow_run) {
		throw new Error("This action must run on workflow that runs on: workflow_run, so it can get the artifact list properly");
	}

	const {id: run_id, check_suite_id, head_sha: sha, pull_requests} = context.payload.workflow_run;

	const response = await octokit.rest.actions.listWorkflowRunArtifacts(
		{
			owner,
			repo,
			run_id,
		}
	);

	const data = formatArtifacts(response, {owner, repo, check_suite_id, sha}, artifactName);

	if (ignoreEmpty && !data.list.length) {
		console.log("Ignoring run because list of artifacts is empty and ignore-empty is 'true'");
		return;
	}

	switch (reportOn) {
		case "commit_status":
			await octokit.rest.repos.createCommitStatus({
				owner,
				repo,
				sha,
				state: processTemplate(commitStatusText, data),
				target_url: processTemplate(commitStatusTargetUrl, data),
				description: processTemplate(message, data),
				context: processTemplate(commitStatusContext, data),
			});
			break;
		case "pull_request":
			if (!pull_requests.length) {
				throw new Error("No pull requests associated with the workflow_run");
			}
			await octokit.rest.issues.createComment({
				owner,
				repo,
				issue_number: pull_requests[0].number,
				body: processTemplate(message, data),
			});
			break;
		case "none":
			break;
		default:
			throw new Error(`Option "report-on" has an invalid value: "${reportOn}"`)
	}
	core.setOutput( 'artifact_id', data.artifact ? data.artifact.id : "" );
	core.setOutput( 'artifact_url', data.artifact ? data.artifact.url : "" );
	core.setOutput('artifact_list', data.list)
}

function formatArtifacts(response, context, queriedArtifactName) {
	const list = response.data.artifacts.map(formatArtifact, context);
	const artifact = findArtifact(list, queriedArtifactName);
	const byName = list.reduce((obj, artifact) => obj[artifact.name] = artifact, {});
	return {
		artifact,
		context,
		queriedArtifactName,
		list,
		byName
	}
}

function formatArtifact(artifactResult) {
	const { owner, repo, check_suite_id, sha} = this;
	const artifactId = artifactResult.id;
	const artifactName = artifactResult.name;
	const artifactUrl = `https://github.com/${owner}/${repo}/suites/${check_suite_id}/artifacts/${artifactId}`;

	return {
		id: artifactId,
		name: artifactName,
		url: artifactUrl,
		commit: sha
	}
}

function processTemplate(template, values) {
	const fn = handlebars.compile(template, {strict: true});
	return fn(values).trim();
}

function reportErrors(error) {
	core.info(error);
	core.setFailed(error.message);
}

function findArtifact(artifacts, artifactName) {
	if (!artifactName) {
		return;
	}

	const artifactResult = artifacts.find(
		( artifact ) => {
			return artifact.name === artifactName;
		}
	);

	if (artifactResult === false) {
		throw new Error(`Artifact '${artifactName} not found`)
	}

	return {
		...artifactResult,
	};
}


run().catch(reportErrors);
