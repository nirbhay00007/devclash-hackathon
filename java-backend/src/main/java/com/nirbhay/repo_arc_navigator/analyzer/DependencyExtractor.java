package com.nirbhay.repo_arc_navigator.analyzer;

import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.nirbhay.repo_arc_navigator.model.Edge;

import java.io.File;
import java.util.*;

public class DependencyExtractor {


    public List<Edge> buildDependencyGraph(List<File> javaFiles)
    {

        // Step 1: Map class name → file name
        Map<String, String> classToFile = new HashMap<>();

        for (File file : javaFiles) {
            String className = file.getName().replace(".java", "");
            classToFile.put(className, file.getName());
        }

        List<Edge> edges = new ArrayList<>();

        // Step 2: Parse each file and extract dependencies
        for (File file : javaFiles)
        {
            try {
                CompilationUnit cu = StaticJavaParser.parse(file);

                String fromClass = file.getName().replace(".java", "");

                cu.getImports().forEach(im -> {
                    String importName = im.getNameAsString();

                    // Extract class name from import
                    String[] parts = importName.split("\\.");
                    String importedClass = parts[parts.length - 1];

                    // Check if it's part of our project
                    if (classToFile.containsKey(importedClass)) {
                        edges.add(new Edge(fromClass, importedClass));
                    }
                });

            } catch (Exception e) {
                System.out.println("Failed to parse: " + file.getName());
            }
        }

        return edges;
    }
}