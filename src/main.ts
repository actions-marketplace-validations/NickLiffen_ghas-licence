import * as dotenv from "dotenv";
dotenv.config({ path: __dirname + "../../.env" });

import * as core from "@actions/core";
import * as artifact from "@actions/artifact";

import { promises as fs } from "fs";

import {
  billing,
  octokit,
  checkCodeScanning,
  getUniqueDataSet,
  sum,
} from "./utils";

import { BillingAPIFunctionResponse } from "../types/common";

import { Octokit } from "./utils/octokitTypes";

const run = async (): Promise<void> => {
  /* Load the Inputs or process.env */
  const org = process.env.CI
    ? core.getInput("org", { required: false })
    : (process.env.ORG as string);
  const token = process.env.CI
    ? core.getInput("token", { required: false })
    : (process.env.API_TOKEN as string);
  const url = process.env.CI
    ? core.getInput("url", { required: false })
    : (process.env.BASE_URL as string);
  const level = process.env.CI
    ? core.getInput("level", { required: false })
    : (process.env.LEVEL as string);

  /* Setting the octokit client */
  const client = (await octokit(token, url)) as Octokit;

  /* Getting all our billing information */
  const verboseBillingData = (await billing(
    client,
    org
  )) as BillingAPIFunctionResponse;

  /* Verbose Repos are all Repos a GHAS active committer on. May not be unique GHAS Unique Active Committers. */
  const { repositories: verboseRepos } = verboseBillingData;

  /* Taking all the verbose dataset and parsing out the repos and their users which are unique */
  const preciseillingData = await getUniqueDataSet(verboseRepos);

  /* PrciseRepos Repos are all Repos a unique GHAS active committer on. */
  const { repositories: prciseRepos } = preciseillingData;

  /* This tells us how many committers there are across all repos */
  const verboseSum = await sum(verboseRepos);

  /* This tells us how many unique committers there are across all repos */
  const uniqueSum = await sum(prciseRepos);

  /* Logging out some information */
  console.log(`Total committers across repos: ${verboseSum}`);

  console.log(`Total unique committers across repos: ${uniqueSum}.`);

  console.log(
    `Total GHAS committers: ${verboseBillingData.total_advanced_security_committers}`
  );
  console.log(
    `Total repos with GHAS committers: ${verboseBillingData.repositories.length}`
  );

  /* This is the dataset that we think we are going to be able to clean GHAS up on */
  const reposWeThinkWeCanRemoveGHASOn = [];

  /* This is the dataset we are going to use the identiy the repos to remove */
  const dataToUse = level === "verbose" ? verboseRepos : prciseRepos;

  /* Let's run the repos through the criteria  */
  for (const repos of dataToUse) {
    /* Checking to see if any code scanning analaysis has been uploaded */
    try {
      const isCodeScanningBeingUsed = await checkCodeScanning(client, repos);
      isCodeScanningBeingUsed === false
        ? reposWeThinkWeCanRemoveGHASOn.push(repos)
        : null;
    } catch (e) {
      console.log(e);
      throw new Error("Failed to run criteris on repos");
    }
  }
  console.log(
    `Total repos that are not using code scanning: ${reposWeThinkWeCanRemoveGHASOn.length}`
  );

  if (process.env.CI) {
    try {
      /* Let's write out the data to a file */
      const stringData = JSON.stringify(reposWeThinkWeCanRemoveGHASOn, null, 2);
      await fs.writeFile("./data.json", stringData, "utf8");
      /* Upload Action to Workflow Run */
      const artifactClient = artifact.create();
      await artifactClient.uploadArtifact("./data.json", ["./data.json"], "./");
    } catch (e) {
      console.log(e);
      core.setFailed(
        `Something went wrong uploading the artefact to the actions workflow: ${e}`
      );
      throw new Error("Failed to upload artifact");
    }
  }
};

run();
