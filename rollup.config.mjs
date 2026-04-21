import { nodeResolve } from "@rollup/plugin-node-resolve";
import { swc } from "rollup-plugin-swc3";

export default {
    input: "src/index.ts",
    output: {
        file: "dist/index.js",
        format: "iife",
    },
    plugins: [
        nodeResolve(),
        swc({
            jsc: {
                parser: { syntax: "typescript" },
                target: "es2019"
            }
        })
    ]
};
