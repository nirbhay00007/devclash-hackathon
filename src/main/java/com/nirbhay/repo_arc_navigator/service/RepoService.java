package com.nirbhay.repo_arc_navigator.service;

import org.eclipse.jgit.api.Git;
import org.springframework.stereotype.Service;

import java.io.File;

@Service
public class RepoService
{

    public String cloneRepo(String repoUrl)
    {
        try
        {
            // Create folder name
            String repoName = repoUrl.substring(repoUrl.lastIndexOf("/") + 1)
                    .replace(".git", "");

            String localPath = "repos/" + repoName + "_" + System.currentTimeMillis();

            File directory = new File(localPath);

            // Create parent folder if not exists
            directory.getParentFile().mkdirs();

            // Clone repository
            Git.cloneRepository()
                    .setURI(repoUrl)
                    .setDirectory(directory)
                    .call();

            return localPath;

        }
        catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException("Error cloning repo");
        }

    }

}
