package com.nirbhay.repo_arc_navigator.service;

import com.nirbhay.repo_arc_navigator.analyzer.DependencyExtractor;
import com.nirbhay.repo_arc_navigator.analyzer.FileScanner;
import com.nirbhay.repo_arc_navigator.model.Edge;
import com.nirbhay.repo_arc_navigator.model.GraphResponse;
import com.nirbhay.repo_arc_navigator.model.Node;
import org.springframework.stereotype.Service;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class GraphService {

    private final RepoService repoService;

    public GraphService(RepoService repoService) {
        this.repoService = repoService;
    }

    public GraphResponse buildGraph(String url) {

        // Step 1: Clone
        String path = repoService.cloneRepo(url);

        // Step 2: Scan
        FileScanner scanner = new FileScanner();
        List<File> files = scanner.getAllJavaFiles(path);

        // Step 3: Analyze
        DependencyExtractor extractor = new DependencyExtractor();
        List<Edge> edges = extractor.buildDependencyGraph(files);

        // Step 4: Build nodes
        Set<String> nodeSet = new HashSet<>();
        for (Edge e : edges) {
            nodeSet.add(e.getFrom());
            nodeSet.add(e.getTo());
        }

        List<Node> nodes = new ArrayList<>();
        for (String n : nodeSet) {
            nodes.add(new Node(n));
        }

        return new GraphResponse(nodes, edges);
    }
}