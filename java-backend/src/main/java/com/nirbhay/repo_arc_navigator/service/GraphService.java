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

/**
 * Core service that builds Java AST dependency graphs.
 *
 * Two modes:
 *  1. buildGraph(url)         - Clone a GitHub repo via RepoService, then analyze
 *  2. buildGraphFromLocal(p)  - Analyze a repo already present on local disk
 *
 * Both delegate to the same internal _buildFromPath logic.
 */
@Service
public class GraphService {

    private final RepoService repoService;

    public GraphService(RepoService repoService) {
        this.repoService = repoService;
    }

    /** Clone from GitHub URL, then build graph. Returns absolute cloned path. */
    public GraphResponse buildGraph(String url) {
        String path = repoService.cloneRepo(url);
        return _buildFromPath(new File(path).getAbsolutePath());
    }

    /** Build graph from a repo already on disk. */
    public GraphResponse buildGraphFromLocal(String localPath) {
        File dir = new File(localPath);
        if (!dir.exists() || !dir.isDirectory()) {
            throw new RuntimeException("Local path does not exist or is not a directory: " + localPath);
        }
        return _buildFromPath(dir.getAbsolutePath());
    }

    /** Shared internal logic: scan → analyze → build nodes & edges. */
    private GraphResponse _buildFromPath(String absolutePath) {
        // Step 1: Scan for all .java files
        FileScanner scanner = new FileScanner();
        List<File> files = scanner.getAllJavaFiles(absolutePath);

        if (files.isEmpty()) {
            return new GraphResponse(new ArrayList<>(), new ArrayList<>(), absolutePath);
        }

        // Step 2: Analyze with JavaParser AST
        DependencyExtractor extractor = new DependencyExtractor();
        List<Edge> edges = extractor.buildDependencyGraph(files);

        // Step 3: Collect unique nodes from edges
        Set<String> nodeSet = new HashSet<>();
        for (Edge e : edges) {
            nodeSet.add(e.getFrom());
            nodeSet.add(e.getTo());
        }
        // Also add files with no edges (isolated classes)
        for (File f : files) {
            nodeSet.add(f.getName().replace(".java", ""));
        }

        List<Node> nodes = new ArrayList<>();
        for (String n : nodeSet) {
            nodes.add(new Node(n));
        }

        return new GraphResponse(nodes, edges, absolutePath);
    }
}