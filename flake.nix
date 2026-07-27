{
  description = "DataHub OKF governed query workspace";
  inputs.nixpkgs.url =
    "github:NixOS/nixpkgs/8623c4c20aa4ca2f5fb81510d2944066c3fb0d96";
  outputs = { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_24 pkgs.pnpm_11 ];
            shellHook = ''
              test "$(node --version)" = "v24.18.0"
              test "$(pnpm --version)" = "11.17.0"
            '';
          };
        });
    };
}
