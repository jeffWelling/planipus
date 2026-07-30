import sys
from PIL import Image

def remove_background(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    pixels = img.load()
    
    # Use a BFS to find contiguous white pixels starting from corners
    visited = set()
    queue = [(0,0), (width-1,0), (0,height-1), (width-1,height-1)]
    
    # We consider anything close to white as background
    def is_bg(color):
        return color[0] > 230 and color[1] > 230 and color[2] > 230
    
    for start_node in queue:
        if start_node in visited:
            continue
        if not is_bg(pixels[start_node[0], start_node[1]]):
            continue
            
        # BFS queue
        q = [start_node]
        visited.add(start_node)
        
        while q:
            x, y = q.pop(0)
            pixels[x, y] = (255, 255, 255, 0) # transparent
            
            for dx, dy in [(-1,0), (1,0), (0,-1), (0,1)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    if (nx, ny) not in visited:
                        if is_bg(pixels[nx, ny]):
                            visited.add((nx, ny))
                            q.append((nx, ny))
                            
    img.save(output_path, "PNG")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python remove_bg.py <input> <output>")
        sys.exit(1)
    remove_background(sys.argv[1], sys.argv[2])
