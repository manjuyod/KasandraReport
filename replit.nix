{ pkgs }:
{
  deps = [
    pkgs.rustc
    pkgs.cargo
    pkgs.nodejs_20
    pkgs.nodePackages.npm
  ];
}
