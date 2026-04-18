package com.nirbhay.repo_arc_navigator.analyzer;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class FileScanner {

    public List<File> getAllJavaFiles(String rootPath) {
        List<File> javaFiles = new ArrayList<>();

        File root = new File(rootPath);

        if (!root.exists()) {
            System.out.println("Directory does not exist: " + rootPath);
            return javaFiles;
        }

        scanDirectory(root, javaFiles);

        return javaFiles;
    }

    private void scanDirectory(File dir, List<File> javaFiles) {
        if (dir == null || !dir.exists()) return;

        File[] files = dir.listFiles();
        if (files == null) return;

        for (File file : files) {

            // Skip unwanted folders early (optimization)
            if (file.isDirectory()) {
                String path = file.getAbsolutePath();

                if (path.contains("\\.git") ||
                        path.contains("\\target") ||
                        path.contains("\\node_modules") ||
                        path.contains("\\.idea")) {
                    continue;
                }

                scanDirectory(file, javaFiles);
            }

            else if (file.getName().endsWith(".java")) {

                // Only include production code
                String path = file.getAbsolutePath();

                if (path.contains("\\src\\main\\java\\")) {
                    System.out.println("Found Java file: " + path);
                    javaFiles.add(file);
                }
            }
        }
    }
}