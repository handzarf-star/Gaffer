// Player database. Names are used only to identify the footballer; there are no photos, likenesses,
// badges or kits. Ratings are this project's own rough "peak form" opinions, NOT official data.
// Era: 'M' = modern (active in the last few seasons), 'L' = legend (retired).

export type Pos = 'GK' | 'LB' | 'CB' | 'RB' | 'CDM' | 'CM' | 'CAM' | 'LW' | 'RW' | 'ST';
export type Era = 'M' | 'L';
export type Tier = 'bronze' | 'silver' | 'gold' | 'icon';

export interface Player {
  id: string;
  name: string;
  nat: string;
  pos: Pos;
  ovr: number;
  era: Era;
  /** appears only in this pool (the Balkan extras are not part of Modern Stars, Legends or Everyone) */
  only?: 'balkan';
}

type Row = [name: string, nat: string, ovr: number];
const raw: Array<[string, string, Pos, number, Era, 'balkan'?]> = [];
function add(era: Era, pos: Pos, rows: Row[], only?: 'balkan') {
  for (const [n, nat, o] of rows) raw.push(only ? [n, nat, pos, o, era, only] : [n, nat, pos, o, era]);
}

/* ───────────── Goalkeepers ───────────── */
add('L', 'GK', [
  ['Lev Yashin', 'RUS', 97], ['Gordon Banks', 'ENG', 93], ['Dino Zoff', 'ITA', 93], ['Sepp Maier', 'GER', 90],
  ['Peter Shilton', 'ENG', 90], ['Peter Schmeichel', 'DEN', 93], ['Gianluigi Buffon', 'ITA', 96], ['Iker Casillas', 'ESP', 95],
  ['Oliver Kahn', 'GER', 94], ['Edwin van der Sar', 'NED', 92], ['Petr Cech', 'CZE', 92], ['Fabien Barthez', 'FRA', 85],
  ['Angelo Peruzzi', 'ITA', 86], ['Claudio Taffarel', 'BRA', 87], ['Jens Lehmann', 'GER', 84], ['Victor Valdes', 'ESP', 86],
  ['Neville Southall', 'WAL', 88], ['Jose Luis Chilavert', 'PAR', 84], ['Gianluca Pagliuca', 'ITA', 86], ['Pepe Reina', 'ESP', 83],
  ['Joe Hart', 'ENG', 82], ['Ubaldo Fillol', 'ARG', 87], ['Thomas N\'Kono', 'CMR', 84], ['Michel Preud\'homme', 'BEL', 86],
  ['Jean-Marie Pfaff', 'BEL', 85], ['Julio Cesar', 'BRA', 87], ['Gilmar', 'BRA', 88], ['Walter Zenga', 'ITA', 87],
  ['Andoni Zubizarreta', 'ESP', 85], ['Rogerio Ceni', 'BRA', 82], ['Packie Bonner', 'IRL', 80], ['Jorge Campos', 'MEX', 78],
]);
add('M', 'GK', [
  ['Manuel Neuer', 'GER', 94], ['Thibaut Courtois', 'BEL', 93], ['Alisson', 'BRA', 92], ['Ederson', 'BRA', 89],
  ['Marc-Andre ter Stegen', 'GER', 89], ['Jan Oblak', 'SVN', 91], ['Gianluigi Donnarumma', 'ITA', 90], ['Emiliano Martinez', 'ARG', 89],
  ['Mike Maignan', 'FRA', 89], ['David de Gea', 'ESP', 87], ['Hugo Lloris', 'FRA', 86], ['Keylor Navas', 'CRC', 86],
  ['Kasper Schmeichel', 'DEN', 83], ['Yann Sommer', 'SUI', 84], ['Unai Simon', 'ESP', 83], ['Diogo Costa', 'POR', 85],
  ['David Raya', 'ESP', 85], ['Jordan Pickford', 'ENG', 82], ['Aaron Ramsdale', 'ENG', 76], ['Gregor Kobel', 'SUI', 85],
  ['Dominik Livakovic', 'CRO', 80], ['Yassine Bounou', 'MAR', 84], ['Wojciech Szczesny', 'POL', 83], ['Bernd Leno', 'GER', 80],
  ['Andre Onana', 'CMR', 80], ['Guillermo Ochoa', 'MEX', 80], ['Kepa Arrizabalaga', 'ESP', 77], ['Robert Sanchez', 'ESP', 74],
  ['Dean Henderson', 'ENG', 76], ['Lukasz Fabianski', 'POL', 79], ['Mile Svilar', 'SRB', 79], ['Bart Verbruggen', 'NED', 78],
  ['Rui Patricio', 'POR', 82], ['Matt Turner', 'USA', 74],
]);

/* ───────────── Centre-backs ───────────── */
add('L', 'CB', [
  ['Franz Beckenbauer', 'GER', 97], ['Bobby Moore', 'ENG', 93], ['Paolo Maldini', 'ITA', 96], ['Franco Baresi', 'ITA', 95],
  ['Fabio Cannavaro', 'ITA', 93], ['Alessandro Nesta', 'ITA', 94], ['Carles Puyol', 'ESP', 92], ['Rio Ferdinand', 'ENG', 91],
  ['John Terry', 'ENG', 91], ['Nemanja Vidic', 'SRB', 92], ['Lilian Thuram', 'FRA', 90], ['Laurent Blanc', 'FRA', 88],
  ['Marcel Desailly', 'FRA', 90], ['Ronald Koeman', 'NED', 90], ['Jaap Stam', 'NED', 91], ['Fernando Hierro', 'ESP', 90],
  ['Roberto Ayala', 'ARG', 87], ['Walter Samuel', 'ARG', 89], ['Lucio', 'BRA', 89], ['Gerard Pique', 'ESP', 90],
  ['Pepe', 'POR', 91], ['Jerome Boateng', 'GER', 88], ['Mats Hummels', 'GER', 90], ['Diego Godin', 'URU', 91],
  ['Giorgio Chiellini', 'ITA', 91], ['Leonardo Bonucci', 'ITA', 89], ['Kalidou Koulibaly', 'SEN', 88], ['Raphael Varane', 'FRA', 89],
  ['Vincent Kompany', 'BEL', 90], ['Tony Adams', 'ENG', 88], ['Alan Hansen', 'SCO', 89], ['Daniel Passarella', 'ARG', 90],
  ['Gaetano Scirea', 'ITA', 93], ['Ricardo Carvalho', 'POR', 88], ['Aldair', 'BRA', 87], ['Ruud Krol', 'NED', 89],
  ['Matthias Sammer', 'GER', 91],
]);
add('M', 'CB', [
  ['Virgil van Dijk', 'NED', 92], ['Ruben Dias', 'POR', 91], ['Marquinhos', 'BRA', 90], ['Antonio Rudiger', 'GER', 89],
  ['Josko Gvardiol', 'CRO', 87], ['William Saliba', 'FRA', 89], ['Matthijs de Ligt', 'NED', 86], ['Kim Min-jae', 'KOR', 85],
  ['Alessandro Bastoni', 'ITA', 88], ['Gabriel Magalhaes', 'BRA', 87], ['Stefan de Vrij', 'NED', 84], ['Milan Skriniar', 'SVK', 85],
  ['Aymeric Laporte', 'ESP', 86], ['John Stones', 'ENG', 86], ['Harry Maguire', 'ENG', 80], ['Eder Militao', 'BRA', 86],
  ['David Alaba', 'AUT', 87], ['Dayot Upamecano', 'FRA', 83], ['Ibrahima Konate', 'FRA', 86], ['Pau Cubarsi', 'ESP', 84],
  ['Nico Schlotterbeck', 'GER', 83], ['Jonathan Tah', 'GER', 83], ['Micky van de Ven', 'NED', 82], ['Levi Colwill', 'ENG', 79],
  ['Marc Guehi', 'ENG', 84], ['Cristian Romero', 'ARG', 88], ['Lisandro Martinez', 'ARG', 85], ['Nicolas Otamendi', 'ARG', 83],
  ['Nathan Ake', 'NED', 84], ['Fikayo Tomori', 'ENG', 80], ['Ronald Araujo', 'URU', 85], ['Jose Maria Gimenez', 'URU', 84],
  ['Mario Hermoso', 'ESP', 78], ['Leny Yoro', 'FRA', 78], ['Willian Pacho', 'ECU', 83], ['Piero Hincapie', 'ECU', 82],
  ['Kevin Danso', 'AUT', 78], ['Sven Botman', 'NED', 80], ['Giorgio Scalvini', 'ITA', 78], ['Thiago Silva', 'BRA', 88],
  ['Sergio Ramos', 'ESP', 89], ['Joel Matip', 'CMR', 80], ['Evan Ndicka', 'CIV', 78], ['Jarrad Branthwaite', 'ENG', 78],
  ['Trevoh Chalobah', 'ENG', 76], ['Jurrien Timber', 'NED', 83],
]);

/* ───────────── Left-backs ───────────── */
add('L', 'LB', [
  ['Roberto Carlos', 'BRA', 94], ['Nilton Santos', 'BRA', 92], ['Giacinto Facchetti', 'ITA', 93], ['Paul Breitner', 'GER', 90],
  ['Andreas Brehme', 'GER', 87], ['Ashley Cole', 'ENG', 91], ['Stuart Pearce', 'ENG', 84], ['Bixente Lizarazu', 'FRA', 88],
  ['Marcelo', 'BRA', 92], ['Patrice Evra', 'FRA', 88], ['Giovanni van Bronckhorst', 'NED', 85], ['Eric Abidal', 'FRA', 86],
  ['Maxwell', 'BRA', 82], ['Fabio Coentrao', 'POR', 84], ['Leighton Baines', 'ENG', 83], ['Denis Irwin', 'IRL', 82],
  ['Graeme Le Saux', 'ENG', 82], ['Mario Zagallo', 'BRA', 84],
]);
add('M', 'LB', [
  ['Alphonso Davies', 'CAN', 86], ['Theo Hernandez', 'FRA', 88], ['Andrew Robertson', 'SCO', 87], ['Joao Cancelo', 'POR', 87],
  ['Alejandro Grimaldo', 'ESP', 86], ['Ferland Mendy', 'FRA', 84], ['Nuno Mendes', 'POR', 87], ['Destiny Udogie', 'ITA', 80],
  ['Luke Shaw', 'ENG', 84], ['Ben Chilwell', 'ENG', 79], ['Marc Cucurella', 'ESP', 83], ['Federico Dimarco', 'ITA', 86],
  ['Lucas Hernandez', 'FRA', 84], ['Jordi Alba', 'ESP', 87], ['David Raum', 'GER', 79], ['Raphael Guerreiro', 'POR', 84],
  ['Ricardo Rodriguez', 'SUI', 80], ['Nicolas Tagliafico', 'ARG', 80], ['Alex Sandro', 'BRA', 82], ['Oleksandr Zinchenko', 'UKR', 82],
  ['Rayan Ait-Nouri', 'ALG', 83], ['Kieran Tierney', 'SCO', 79],
]);

/* ───────────── Right-backs ───────────── */
add('L', 'RB', [
  ['Cafu', 'BRA', 94], ['Philipp Lahm', 'GER', 94], ['Dani Alves', 'BRA', 92], ['Javier Zanetti', 'ARG', 91],
  ['Carlos Alberto Torres', 'BRA', 90], ['Djalma Santos', 'BRA', 91], ['Berti Vogts', 'GER', 88], ['Gianluca Zambrotta', 'ITA', 88],
  ['Maicon', 'BRA', 89], ['Gary Neville', 'ENG', 85], ['Branislav Ivanovic', 'SRB', 86], ['Alvaro Arbeloa', 'ESP', 80],
  ['Michael Reiziger', 'NED', 80], ['Cesare Maldini', 'ITA', 84],
]);
add('M', 'RB', [
  ['Trent Alexander-Arnold', 'ENG', 89], ['Achraf Hakimi', 'MAR', 90], ['Kyle Walker', 'ENG', 85], ['Jules Kounde', 'FRA', 87],
  ['Reece James', 'ENG', 85], ['Dani Carvajal', 'ESP', 88], ['Jeremie Frimpong', 'NED', 84], ['Pedro Porro', 'ESP', 84],
  ['Denzel Dumfries', 'NED', 83], ['Joshua Kimmich', 'GER', 89], ['Kieran Trippier', 'ENG', 82], ['Marcos Llorente', 'ESP', 82],
  ['Nahuel Molina', 'ARG', 80], ['Lutsharel Geertruida', 'NED', 80], ['Ben White', 'ENG', 82], ['Vanderson', 'BRA', 80],
  ['Danilo', 'BRA', 80], ['Giovanni Di Lorenzo', 'ITA', 82], ['Noussair Mazraoui', 'MAR', 80], ['Diogo Dalot', 'POR', 82],
  ['Malo Gusto', 'FRA', 78], ['Wesley Fofana', 'FRA', 80], ['Matty Cash', 'POL', 76],
]);

/* ───────────── Defensive midfielders ───────────── */
add('L', 'CDM', [
  ['Lothar Matthaus', 'GER', 95], ['Claude Makelele', 'FRA', 91], ['Fernando Redondo', 'ARG', 91], ['Dunga', 'BRA', 85],
  ['Roy Keane', 'IRL', 92], ['Patrick Vieira', 'FRA', 92], ['Frank Rijkaard', 'NED', 91], ['Sergio Busquets', 'ESP', 93],
  ['Xabi Alonso', 'ESP', 92], ['Javier Mascherano', 'ARG', 89], ['Gennaro Gattuso', 'ITA', 86], ['Demetrio Albertini', 'ITA', 88],
  ['Marcos Senna', 'ESP', 84], ['Didier Deschamps', 'FRA', 86], ['Emmanuel Petit', 'FRA', 87], ['Edgar Davids', 'NED', 88],
  ['Michael Essien', 'GHA', 89], ['Gilberto Silva', 'BRA', 86], ['Mauro Silva', 'BRA', 82], ['Paul Ince', 'ENG', 85],
  ['Stefan Effenberg', 'GER', 87], ['Owen Hargreaves', 'ENG', 82], ['Nigel de Jong', 'NED', 80], ['Mark van Bommel', 'NED', 84],
  ['Daniele De Rossi', 'ITA', 89], ['Nobby Stiles', 'ENG', 80],
]);
add('M', 'CDM', [
  ['Rodri', 'ESP', 95], ['Declan Rice', 'ENG', 89], ['Casemiro', 'BRA', 86], ['Fabinho', 'BRA', 83],
  ['N\'Golo Kante', 'FRA', 89], ['Aurelien Tchouameni', 'FRA', 86], ['Martin Zubimendi', 'ESP', 86], ['Marcelo Brozovic', 'CRO', 84],
  ['Jorginho', 'ITA', 82], ['Wilfred Ndidi', 'NGA', 80], ['Sandro Tonali', 'ITA', 85], ['Ruben Neves', 'POR', 82],
  ['Granit Xhaka', 'SUI', 85], ['Moises Caicedo', 'ECU', 87], ['Alexis Mac Allister', 'ARG', 87], ['Enzo Fernandez', 'ARG', 85],
  ['Rodrigo De Paul', 'ARG', 84], ['Leandro Paredes', 'ARG', 78], ['Manuel Locatelli', 'ITA', 82], ['Amadou Onana', 'BEL', 80],
  ['Joao Palhinha', 'POR', 82], ['Edson Alvarez', 'MEX', 80], ['Scott McTominay', 'SCO', 83], ['Bruno Guimaraes', 'BRA', 86],
  ['Pape Matar Sarr', 'SEN', 80], ['Sofyan Amrabat', 'MAR', 80], ['Thomas Partey', 'GHA', 83], ['Adam Wharton', 'ENG', 80],
  ['Douglas Luiz', 'BRA', 80], ['Idrissa Gueye', 'SEN', 78],
]);

/* ───────────── Central midfielders ───────────── */
add('L', 'CM', [
  ['Andres Iniesta', 'ESP', 96], ['Xavi', 'ESP', 96], ['Johan Neeskens', 'NED', 90], ['Paul Scholes', 'ENG', 93],
  ['Steven Gerrard', 'ENG', 93], ['Frank Lampard', 'ENG', 92], ['Socrates', 'BRA', 91], ['Falcao', 'BRA', 91],
  ['Didi', 'BRA', 90], ['Andrea Pirlo', 'ITA', 95], ['Clarence Seedorf', 'NED', 90], ['Marco Tardelli', 'ITA', 89],
  ['Bryan Robson', 'ENG', 90], ['Bobby Charlton', 'ENG', 94], ['Michael Ballack', 'GER', 91], ['Bastian Schweinsteiger', 'GER', 91],
  ['Toni Kroos', 'GER', 94], ['Thiago Alcantara', 'ESP', 87], ['Cesc Fabregas', 'ESP', 90], ['Pavel Nedved', 'CZE', 93],
  ['Yaya Toure', 'CIV', 91], ['Sami Khedira', 'GER', 85], ['Michael Carrick', 'ENG', 85], ['Gerson', 'BRA', 88],
  ['Ivan Rakitic', 'CRO', 86], ['Gheorghe Popescu', 'ROU', 84], ['Hidetoshi Nakata', 'JPN', 82], ['Park Ji-sung', 'KOR', 83],
  ['Mohamed Elneny', 'EGY', 75], ['Mikel Arteta', 'ESP', 84], ['Juninho Pernambucano', 'BRA', 86],
]);
add('M', 'CM', [
  ['Kevin De Bruyne', 'BEL', 94], ['Jude Bellingham', 'ENG', 92], ['Luka Modric', 'CRO', 92], ['Frenkie de Jong', 'NED', 87],
  ['Federico Valverde', 'URU', 90], ['Pedri', 'ESP', 89], ['Vitinha', 'POR', 88], ['Fabian Ruiz', 'ESP', 85],
  ['Bernardo Silva', 'POR', 90], ['Ilkay Gundogan', 'GER', 86], ['Marco Verratti', 'ITA', 88], ['Nicolo Barella', 'ITA', 87],
  ['Sergej Milinkovic-Savic', 'SRB', 85], ['Dominik Szoboszlai', 'HUN', 86], ['Joao Neves', 'POR', 85], ['Warren Zaire-Emery', 'FRA', 82],
  ['Eduardo Camavinga', 'FRA', 85], ['Youri Tielemans', 'BEL', 81], ['Mateo Kovacic', 'CRO', 85], ['Mason Mount', 'ENG', 79],
  ['Conor Gallagher', 'ENG', 80], ['Kobbie Mainoo', 'ENG', 79], ['Christian Eriksen', 'DEN', 85], ['Leon Goretzka', 'GER', 84],
  ['Pierre-Emile Hojbjerg', 'DEN', 82], ['Weston McKennie', 'USA', 78], ['Tyler Adams', 'USA', 78], ['Rodrigo Bentancur', 'URU', 82],
  ['Manuel Ugarte', 'URU', 80], ['Giovani Lo Celso', 'ARG', 80], ['Marcel Sabitzer', 'AUT', 83], ['Konrad Laimer', 'AUT', 80],
  ['Hakan Calhanoglu', 'TUR', 87], ['Gavi', 'ESP', 84], ['Mikel Merino', 'ESP', 83], ['Fermin Lopez', 'ESP', 80],
  ['Ryan Gravenberch', 'NED', 85], ['Tijjani Reijnders', 'NED', 84], ['Teun Koopmeiners', 'NED', 83], 
  ['Thiago Almada', 'ARG', 79], ['Nico Gonzalez', 'ESP', 82], ['Lewis Miley', 'ENG', 70], 
  ['Alan Varela', 'ARG', 76], ['Matteo Guendouzi', 'FRA', 80], ['Adrien Rabiot', 'FRA', 84], 
  ['Franck Kessie', 'CIV', 79],
]);

/* ───────────── Attacking midfielders ───────────── */
add('L', 'CAM', [
  ['Zinedine Zidane', 'FRA', 97], ['Michel Platini', 'FRA', 95], ['Zico', 'BRA', 94], ['Rivaldo', 'BRA', 93],
  ['Roberto Baggio', 'ITA', 95], ['Dennis Bergkamp', 'NED', 93], ['Kaka', 'BRA', 94], ['Gheorghe Hagi', 'ROU', 93],
  ['Juan Roman Riquelme', 'ARG', 91], ['Deco', 'POR', 90], ['Rui Costa', 'POR', 90], ['Ruud Gullit', 'NED', 94],
  ['Mesut Ozil', 'GER', 90], ['Wesley Sneijder', 'NED', 90], ['David Silva', 'ESP', 91], ['Gianni Rivera', 'ITA', 92],
  ['Sandro Mazzola', 'ITA', 90], ['Jay-Jay Okocha', 'NGA', 88], ['Francesco Totti', 'ITA', 94], ['Alessandro Del Piero', 'ITA', 93],
  ['Carlos Valderrama', 'COL', 88], ['Enzo Francescoli', 'URU', 90], ['Paul Gascoigne', 'ENG', 89], ['Michael Laudrup', 'DEN', 91],
  ['Brian Laudrup', 'DEN', 88], ['Teofilo Cubillas', 'PER', 90], ['Roberto Rivelino', 'BRA', 91], ['Diego Maradona', 'ARG', 99],
  ['Shinji Kagawa', 'JPN', 82], ['Juan Mata', 'ESP', 85], ['Isco', 'ESP', 85], ['James Rodriguez', 'COL', 86],
  ['Matt Le Tissier', 'ENG', 84], ['Pablo Aimar', 'ARG', 87], ['Ricardo Quaresma', 'POR', 82], ['Javier Pastore', 'ARG', 85],
]);
add('M', 'CAM', [
  ['Bruno Fernandes', 'POR', 89], ['Martin Odegaard', 'NOR', 90], ['Jamal Musiala', 'GER', 90], ['Florian Wirtz', 'GER', 90],
  ['Phil Foden', 'ENG', 89], ['Dani Olmo', 'ESP', 86], ['Arda Guler', 'TUR', 83], ['Lucas Paqueta', 'BRA', 83],
  ['Rayan Cherki', 'FRA', 82], ['Xavi Simons', 'NED', 83], ['Joao Felix', 'POR', 82], ['Antoine Griezmann', 'FRA', 88],
  ['Thomas Muller', 'GER', 88], ['Paulo Dybala', 'ARG', 87], ['Cole Palmer', 'ENG', 90], ['Jack Grealish', 'ENG', 82],
  ['Christopher Nkunku', 'FRA', 83], ['Emile Smith Rowe', 'ENG', 76],
  ['Eberechi Eze', 'ENG', 83], ['Morgan Gibbs-White', 'ENG', 79], ['Hakim Ziyech', 'MAR', 80], ['Matheus Cunha', 'BRA', 83],
  ['Giorgian de Arrascaeta', 'URU', 82], ['Nico Paz', 'ARG', 78],
  ['Brahim Diaz', 'MAR', 82],
]);

/* ───────────── Left wingers ───────────── */
add('L', 'LW', [
  ['Ronaldinho', 'BRA', 95], ['Ryan Giggs', 'WAL', 91], ['Eden Hazard', 'BEL', 91], ['Franck Ribery', 'FRA', 91],
  ['Hristo Stoichkov', 'BUL', 91], ['Marc Overmars', 'NED', 86], ['Robert Pires', 'FRA', 87], ['Andrei Arshavin', 'RUS', 84],
  ['Alexis Sanchez', 'CHI', 87], ['Jairzinho', 'BRA', 91], ['Pedro Rodriguez', 'ESP', 84],
  ['Douglas Costa', 'BRA', 83], ['Paulo Futre', 'POR', 86], ['Ariel Ortega', 'ARG', 82],
  ['Lukas Podolski', 'GER', 82], ['Dimitri Payet', 'FRA', 83],
]);
add('M', 'LW', [
  ['Neymar', 'BRA', 93], ['Vinicius Junior', 'BRA', 94], ['Rafael Leao', 'POR', 88], ['Son Heung-min', 'KOR', 90],
  ['Sadio Mane', 'SEN', 88], ['Leroy Sane', 'GER', 86], ['Kingsley Coman', 'FRA', 85], ['Gabriel Martinelli', 'BRA', 83],
  ['Marcus Rashford', 'ENG', 85], ['Jadon Sancho', 'ENG', 80], ['Raheem Sterling', 'ENG', 85], ['Anthony Gordon', 'ENG', 82],
  ['Luis Diaz', 'COL', 87], ['Khvicha Kvaratskhelia', 'GEO', 88], ['Bradley Barcola', 'FRA', 84], ['Nico Williams', 'ESP', 87],
  ['Alejandro Garnacho', 'ARG', 80], ['Cody Gakpo', 'NED', 85], ['Kaoru Mitoma', 'JPN', 80], ['Jeremy Doku', 'BEL', 82],
  ['Federico Chiesa', 'ITA', 82], ['Leandro Trossard', 'BEL', 80], ['Ferran Torres', 'ESP', 80], ['Mikel Oyarzabal', 'ESP', 85],
  ['Noni Madueke', 'ENG', 78], ['Kenan Yildiz', 'TUR', 82], ['Rodrygo', 'BRA', 86], ['Anthony Elanga', 'SWE', 74],
  ['Gabriel Jesus', 'BRA', 82], ['Christian Pulisic', 'USA', 82],
  ['Hirving Lozano', 'MEX', 78], ['Ademola Lookman', 'NGA', 83],
]);

/* ───────────── Right wingers ───────────── */
add('L', 'RW', [
  ['Garrincha', 'BRA', 96], ['Stanley Matthews', 'ENG', 90], ['Arjen Robben', 'NED', 91],
  ['Luis Figo', 'POR', 93], ['David Beckham', 'ENG', 90], ['Gareth Bale', 'WAL', 91], ['Angel Di Maria', 'ARG', 90],
  ['Chris Waddle', 'ENG', 84],
  ['Willian', 'BRA', 82], 
  ['Antonio Di Natale', 'ITA', 84], ['Juan Cuadrado', 'COL', 82], 
  ['Shaun Wright-Phillips', 'ENG', 76], ['Damien Duff', 'IRL', 82],
]);
add('M', 'RW', [
  ['Lionel Messi', 'ARG', 99], ['Mohamed Salah', 'EGY', 94], ['Lamine Yamal', 'ESP', 93], ['Ousmane Dembele', 'FRA', 90],
  ['Raphinha', 'BRA', 90], ['Bukayo Saka', 'ENG', 90], ['Riyad Mahrez', 'ALG', 87], ['Michael Olise', 'FRA', 87],
  ['Desire Doue', 'FRA', 84], ['Takefusa Kubo', 'JPN', 82], ['Mohammed Kudus', 'GHA', 83], ['Bryan Mbeumo', 'CMR', 83],
  ['Antony', 'BRA', 74], ['Savinho', 'BRA', 80], ['Yeremy Pino', 'ESP', 78], ['Pedro Neto', 'POR', 80],
  ['Francisco Conceicao', 'POR', 80], ['Serge Gnabry', 'GER', 84], 
  ['Ivan Perisic', 'CRO', 81], ['Dejan Kulusevski', 'SWE', 83], ['Alex Iwobi', 'NGA', 77], 
  ['Gerard Moreno', 'ESP', 80], ['Amad Diallo', 'CIV', 79], 
  ['Johan Bakayoko', 'BEL', 76], ['Ritsu Doan', 'JPN', 79], 
  ['Julian Brandt', 'GER', 82], ['Anthony Martial', 'FRA', 78],
]);

/* ───────────── Strikers ───────────── */
add('L', 'ST', [
  ['Pele', 'BRA', 99], ['Johan Cruyff', 'NED', 98], ['Ronaldo Nazario', 'BRA', 98], ['Gerd Muller', 'GER', 96],
  ['Eusebio', 'POR', 95], ['Marco van Basten', 'NED', 96], ['Romario', 'BRA', 94], ['Ferenc Puskas', 'HUN', 96],
  ['Alfredo Di Stefano', 'ARG', 96], ['Thierry Henry', 'FRA', 95], ['Zlatan Ibrahimovic', 'SWE', 93], ['Raul', 'ESP', 91],
  ['Gabriel Batistuta', 'ARG', 92], ['Hernan Crespo', 'ARG', 87], ['Alan Shearer', 'ENG', 91], ['Gary Lineker', 'ENG', 88],
  ['Michael Owen', 'ENG', 87], ['Wayne Rooney', 'ENG', 91], ['Ruud van Nistelrooy', 'NED', 91], ['Andriy Shevchenko', 'UKR', 93],
  ['Filippo Inzaghi', 'ITA', 86], ['Christian Vieri', 'ITA', 88], ['Paolo Rossi', 'ITA', 91], ['Gianluca Vialli', 'ITA', 88],
  ['Jurgen Klinsmann', 'GER', 90], ['Rudi Voller', 'GER', 88], ['Miroslav Klose', 'GER', 90], ['Karl-Heinz Rummenigge', 'GER', 92],
  ['David Villa', 'ESP', 90], ['Fernando Torres', 'ESP', 90], ['Diego Forlan', 'URU', 88], ['Luis Suarez', 'URU', 91],
  ['Didier Drogba', 'CIV', 91], ['Samuel Eto\'o', 'CMR', 91], ['George Weah', 'LBR', 90], ['Hugo Sanchez', 'MEX', 86],
  ['Davor Suker', 'CRO', 88], ['Kenny Dalglish', 'SCO', 91], ['Jimmy Greaves', 'ENG', 91], ['Denis Law', 'SCO', 90],
  ['Ian Rush', 'WAL', 89], ['Sergio Aguero', 'ARG', 91], ['Carlos Tevez', 'ARG', 88], ['Gonzalo Higuain', 'ARG', 88],
  ['Edinson Cavani', 'URU', 89], ['Radamel Falcao', 'COL', 88], ['Robin van Persie', 'NED', 91], ['Mario Mandzukic', 'CRO', 86],
  ['Just Fontaine', 'FRA', 88], ['Roger Milla', 'CMR', 82], ['Teddy Sheringham', 'ENG', 82], ['Jamie Vardy', 'ENG', 83],
  ['Tostao', 'BRA', 90], ['Eric Cantona', 'FRA', 90], ['Kevin Keegan', 'ENG', 88],
  ['Andy Cole', 'ENG', 84], ['Luca Toni', 'ITA', 86], 
  ['Dirk Kuyt', 'NED', 82], ['Klaas-Jan Huntelaar', 'NED', 84], ['Roberto Pruzzo', 'ITA', 80],
]);
add('M', 'ST', [
  ['Cristiano Ronaldo', 'POR', 96], ['Karim Benzema', 'FRA', 93], ['Robert Lewandowski', 'POL', 94], ['Harry Kane', 'ENG', 93],
  ['Erling Haaland', 'NOR', 95], ['Kylian Mbappe', 'FRA', 96], ['Lautaro Martinez', 'ARG', 89], ['Victor Osimhen', 'NGA', 88],
  ['Julian Alvarez', 'ARG', 87], ['Darwin Nunez', 'URU', 80], ['Alexander Isak', 'SWE', 88], ['Viktor Gyokeres', 'SWE', 87],
  ['Ollie Watkins', 'ENG', 83], ['Marcus Thuram', 'FRA', 84], ['Rasmus Hojlund', 'DEN', 78], ['Dusan Vlahovic', 'SRB', 85],
  ['Alvaro Morata', 'ESP', 82], ['Richarlison', 'BRA', 80], ['Roberto Firmino', 'BRA', 84], ['Randal Kolo Muani', 'FRA', 80],
  ['Jonathan David', 'CAN', 83], ['Jhon Duran', 'COL', 76], ['Mateo Retegui', 'ITA', 80], ['Serhou Guirassy', 'GUI', 83],
  ['Santiago Gimenez', 'MEX', 80], ['Artem Dovbyk', 'UKR', 80], ['Kai Havertz', 'GER', 84], ['Niclas Fullkrug', 'GER', 80],
  ['Lois Openda', 'BEL', 80], ['Romelu Lukaku', 'BEL', 86], ['Ivan Toney', 'ENG', 80], ['Dominic Solanke', 'ENG', 79],
  ['Benjamin Sesko', 'SVN', 82], ['Hugo Ekitike', 'FRA', 82], ['Alexander Sorloth', 'NOR', 80], ['Memphis Depay', 'NED', 83],
  ['Brian Brobbey', 'NED', 78], ['Joshua Zirkzee', 'NED', 76], ['Mehdi Taremi', 'IRN', 80], ['Aleksandar Mitrovic', 'SRB', 80],
  ['Ciro Immobile', 'ITA', 84], ['Mauro Icardi', 'ARG', 82], ['Nicolas Jackson', 'SEN', 80], ['Sebastien Haller', 'CIV', 76],
  ['Olivier Giroud', 'FRA', 85], ['Raul Jimenez', 'MEX', 78], ['Jean-Philippe Mateta', 'FRA', 78],
  ['Evan Ferguson', 'IRL', 74], ['Tammy Abraham', 'ENG', 78], ['Callum Wilson', 'ENG', 77], ['Ayoze Perez', 'ESP', 76],
  ['Takumi Minamino', 'JPN', 76], ['Hwang Hee-chan', 'KOR', 78], ['Cho Gue-sung', 'KOR', 72], 
  ['Arkadiusz Milik', 'POL', 80], ['Krzysztof Piatek', 'POL', 74], ['Patrik Schick', 'CZE', 82], ['Ante Budimir', 'CRO', 78],
  ['Andrej Kramaric', 'CRO', 82], ['Mario Gotze', 'GER', 82], ['Timo Werner', 'GER', 80], 
  ['Duvan Zapata', 'COL', 79], ['Folarin Balogun', 'USA', 76],
  ['Alexandre Lacazette', 'FRA', 82], ['Enner Valencia', 'ECU', 78],
  ['Cyle Larin', 'CAN', 74], ['Giovanni Simeone', 'ARG', 80],
]);


/* ───────────── extra legends for thin positions ───────────── */
add('L', 'RW', [
  ['Joaquin', 'ESP', 84], ['Aaron Lennon', 'ENG', 78], ['Antonio Candreva', 'ITA', 80], ['Jesus Navas', 'ESP', 85],
  ['Steve McManaman', 'ENG', 84], ['Nani', 'POR', 85],
]);
add('L', 'LW', [
  ['Joe Cole', 'ENG', 84], ['Ashley Young', 'ENG', 79], ['Ryan Babel', 'NED', 78],
  ['Rafael van der Vaart', 'NED', 86],
]);
add('L', 'RB', [['Bacary Sagna', 'FRA', 82], ['Pablo Zabaleta', 'ARG', 84], ['Glen Johnson', 'ENG', 80], ['Juanfran', 'ESP', 80]]);
add('L', 'LB', [['Gael Clichy', 'FRA', 82], ['Fabio Grosso', 'ITA', 83]]);
add('L', 'ST', [['Mario Kempes', 'ARG', 91], ['Pedro Pauleta', 'POR', 85], ['Ally McCoist', 'SCO', 80], ]);

/* ───────────────────────────────────────── helpers ───────────────────────────────────────── */

/* ───────────── Balkan extras (Bosnia, Croatia, Serbia): only in the Balkan pool ─────────────
   Current internationals and a few league players from the region. Ratings are my own rough opinions and the squads are
   from memory, so check them: the Bosnian league is not here because I could not recall it reliably. */
const B = 'balkan' as const;
add('M', 'GK', [['Ivica Ivusic', 'CRO', 76], ['Dominik Kotarski', 'CRO', 75], ['Vanja Milinkovic-Savic', 'SRB', 79], ['Predrag Rajkovic', 'SRB', 76], ['Djordje Petrovic', 'SRB', 75], ['Nikola Vasilj', 'BIH', 78], ['Kenan Piric', 'BIH', 72]], B);
add('M', 'CB', [
  ['Josip Sutalo', 'CRO', 80], ['Marin Pongracic', 'CRO', 80], ['Duje Caleta-Car', 'CRO', 79], ['Martin Erlic', 'CRO', 76],
  ['Nikola Milenkovic', 'SRB', 82], ['Strahinja Pavlovic', 'SRB', 79], ['Milos Veljkovic', 'SRB', 75], ['Srdjan Babic', 'SRB', 72], ['Uros Spajic', 'SRB', 72],
  ['Anel Ahmedhodzic', 'BIH', 77], ['Dennis Hadzikadunic', 'BIH', 73], ['Tarik Muharemovic', 'BIH', 72],
], B);
add('M', 'LB', [['Borna Barisic', 'CRO', 77], ['Borna Sosa', 'CRO', 77], ['Filip Kostic', 'SRB', 80], ['Sead Kolasinac', 'BIH', 80], ['Milan Rodic', 'SRB', 71]], B);
add('M', 'RB', [['Josip Stanisic', 'CRO', 82], ['Josip Juranovic', 'CRO', 77], ['Amar Dedic', 'BIH', 77], ['Jusuf Gazibegovic', 'BIH', 73]], B);
add('M', 'CDM', [
  ['Kristijan Jakic', 'CRO', 77], ['Nikola Moro', 'CRO', 76], ['Nemanja Gudelj', 'SRB', 76], ['Nemanja Maksimovic', 'SRB', 74], ['Marko Grujic', 'SRB', 77],
  ['Sasa Lukic', 'SRB', 78], ['Uros Racic', 'SRB', 74], ['Amir Hadziahmetovic', 'BIH', 72], ['Benjamin Tahirovic', 'BIH', 74],
], B);
add('M', 'CM', [['Mario Pasalic', 'CRO', 83], ['Luka Sucic', 'CRO', 78], ['Petar Sucic', 'CRO', 77], ['Ivan Ilic', 'SRB', 77], ['Rade Krunic', 'BIH', 74]], B);
add('M', 'CAM', [
  ['Lovro Majer', 'CRO', 80], ['Nikola Vlasic', 'CRO', 79], ['Martin Baturina', 'CRO', 78], ['Luka Ivanusec', 'CRO', 76], ['Toni Fruk', 'CRO', 73],
  ['Dusan Tadic', 'SRB', 82], ['Lazar Samardzic', 'SRB', 79], ['Filip Djuricic', 'SRB', 74], ['Mirko Ivanic', 'SRB', 73], ['Mijat Gacinovic', 'SRB', 72],
], B);
add('M', 'LW', [['Josip Brekalo', 'CRO', 75], ['Mislav Orsic', 'CRO', 77], ['Nemanja Radonjic', 'SRB', 75], ['Andrija Zivkovic', 'SRB', 75], ['Darko Lazovic', 'SRB', 71], ['Marco Pasalic', 'CRO', 73]], B);
add('M', 'RW', [['Esmir Bajraktarevic', 'BIH', 76], ['Veljko Birmancevic', 'SRB', 72], ['Miroslav Stevanovic', 'BIH', 72], ['Kerim Alajbegovic', 'BIH', 70]], B);
add('M', 'ST', [
  ['Marko Livaja', 'CRO', 79], ['Bruno Petkovic', 'CRO', 78], ['Franjo Ivanovic', 'CRO', 76], ['Igor Matanovic', 'CRO', 74], ['Sandro Kulenovic', 'CRO', 72],
  ['Edin Dzeko', 'BIH', 82], ['Ermedin Demirovic', 'BIH', 80], ['Smail Prevljak', 'BIH', 71], ['Luka Jovic', 'SRB', 76], ['Milan Pavkov', 'SRB', 70],
], B);

export function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const PLAYERS: readonly Player[] = raw.map(([name, nat, pos, ovr, era, only]) => ({
  id: slug(name),
  name,
  nat,
  pos,
  ovr,
  era,
  ...(only ? { only } : {}),
}));

export const PLAYER_BY_ID: ReadonlyMap<string, Player> = new Map(PLAYERS.map((p) => [p.id, p]));

/* ───────────── runtime additions (career mode) ─────────────
   The career squads are not part of the draft pools (they are not in PLAYERS), but the match engine, chemistry and fit
   logic all read players through player(id). So career players are registered here, and a league can lay its own current
   ratings over the top (ageing, settling-in) for the length of one synchronous call, without touching global data. */
const EXTRA = new Map<string, Player>();
let overlay: ReadonlyMap<string, Player> | null = null;

/** Make extra players known to player(). Ids must not clash with the built-in pool. */
export function registerPlayers(list: readonly Player[]): void {
  for (const p of list) {
    if (PLAYER_BY_ID.has(p.id)) throw new Error(`Career player id clashes with the draft pool: ${p.id}`);
    EXTRA.set(p.id, p);
  }
}

/** Run `fn` with some players' ratings replaced. Synchronous only: the override is gone when `fn` returns. */
export function withRatings<T>(ovr: Readonly<Record<string, number>>, fn: () => T): T {
  const prev = overlay;
  const next = new Map<string, Player>(prev ?? []);
  for (const [id, o] of Object.entries(ovr)) {
    const base = prev?.get(id) ?? PLAYER_BY_ID.get(id) ?? EXTRA.get(id);
    if (base) next.set(id, { ...base, ovr: o });
  }
  overlay = next;
  try {
    return fn();
  } finally {
    overlay = prev;
  }
}

export function player(id: string): Player {
  const p = overlay?.get(id) ?? PLAYER_BY_ID.get(id) ?? EXTRA.get(id);
  if (!p) throw new Error(`Unknown player id: ${id}`);
  return p;
}

export function tierOf(ovr: number): Tier {
  if (ovr >= 93) return 'icon';
  if (ovr >= 87) return 'gold';
  if (ovr >= 80) return 'silver';
  return 'bronze';
}

export const TIER_LABEL: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', icon: 'Icon' };

const PARTICLES = new Set(['van', 'de', 'der', 'den', 'ter', 'ten', 'di', 'da', 'dos', 'do', 'la', 'le', 'von', 'al', 'el', 'bin']);

/** "Trent Alexander-Arnold" -> "Alexander-Arnold", "Kevin De Bruyne" -> "De Bruyne", "Cristiano Ronaldo" -> "Ronaldo". */
export function shortName(full: string): string {
  const parts = full.split(' ');
  if (parts.length === 1) return full;
  let i = parts.length - 1;
  if (parts[i]!.toLowerCase() === 'jr' && i > 0) i--;
  while (i > 0 && PARTICLES.has(parts[i - 1]!.toLowerCase())) i--;
  return parts.slice(i).join(' ');
}
